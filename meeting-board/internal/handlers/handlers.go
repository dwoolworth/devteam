package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/devteam/meeting-board/internal/models"
	"github.com/devteam/meeting-board/internal/store"
	"github.com/devteam/meeting-board/internal/ws"
	"github.com/gorilla/mux"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type contextKey string

const authorKey contextKey = "author"

var mentionRe = regexp.MustCompile(`@(po|dev|cq|qa|ops)`)

// Handlers holds the dependencies required by HTTP handler functions.
type Handlers struct {
	Store  *store.Store
	Hub    *ws.Hub
	Tokens map[string]string // role -> bearer token
}

// respondJSON writes a JSON response with the given status code.
func respondJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		json.NewEncoder(w).Encode(data)
	}
}

// respondError writes a JSON error response.
func respondError(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, map[string]string{"error": msg})
}

// AuthMiddleware extracts the Bearer token from the Authorization header,
// resolves the author role, and injects it into the request context.
// Dashboard requests (no auth) are treated as "human".
func (h *Handlers) AuthMiddleware(next http.Handler) http.Handler {
	// Build a reverse map: token -> role for fast lookup.
	tokenToRole := make(map[string]string, len(h.Tokens))
	for role, token := range h.Tokens {
		tokenToRole[token] = role
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")

		// No auth header -> human (dashboard user).
		if authHeader == "" {
			ctx := context.WithValue(r.Context(), authorKey, "human")
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// Check for "Bearer <token>" format.
		if !strings.HasPrefix(authHeader, "Bearer ") {
			respondError(w, http.StatusUnauthorized, "invalid authorization header format")
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")

		// Special dashboard token.
		if token == "dashboard" {
			ctx := context.WithValue(r.Context(), authorKey, "human")
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		role, ok := tokenToRole[token]
		if !ok {
			respondError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		ctx := context.WithValue(r.Context(), authorKey, role)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// getAuthor extracts the author string from the request context.
func getAuthor(r *http.Request) string {
	if author, ok := r.Context().Value(authorKey).(string); ok {
		return author
	}
	return "human"
}

// ---------------------------------------------------------------------------
// Channel handlers
// ---------------------------------------------------------------------------

// ListChannels handles GET /api/channels.
func (h *Handlers) ListChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := h.Store.ListChannels(r.Context())
	if err != nil {
		log.Printf("handler: list channels: %v", err)
		respondError(w, http.StatusInternalServerError, "failed to list channels")
		return
	}
	respondJSON(w, http.StatusOK, channels)
}

// CreateChannel handles POST /api/channels.
func (h *Handlers) CreateChannel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		respondError(w, http.StatusBadRequest, "channel name is required")
		return
	}

	ch := &models.Channel{
		Name:        strings.TrimSpace(req.Name),
		Description: strings.TrimSpace(req.Description),
	}

	if err := h.Store.CreateChannel(r.Context(), ch); err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			respondError(w, http.StatusConflict, "channel already exists")
			return
		}
		log.Printf("handler: create channel: %v", err)
		respondError(w, http.StatusInternalServerError, "failed to create channel")
		return
	}

	author := getAuthor(r)
	h.Store.CreateAuditEntry(r.Context(), &models.AuditEntry{
		Actor:  author,
		Action: "channel.create",
		Details: map[string]any{
			"channel_id":   ch.ID.Hex(),
			"channel_name": ch.Name,
		},
	})

	respondJSON(w, http.StatusCreated, ch)
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

// ListMessages handles GET /api/channels/{id}/messages.
func (h *Handlers) ListMessages(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	channelID, err := primitive.ObjectIDFromHex(vars["id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	var since *time.Time
	if sinceStr := r.URL.Query().Get("since"); sinceStr != "" {
		t, err := time.Parse(time.RFC3339, sinceStr)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid since parameter, use RFC3339 format")
			return
		}
		since = &t
	}

	limit := int64(50)
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		l, err := strconv.ParseInt(limitStr, 10, 64)
		if err == nil && l > 0 {
			limit = l
		}
	}

	messages, err := h.Store.ListMessages(r.Context(), channelID, since, limit)
	if err != nil {
		log.Printf("handler: list messages: %v", err)
		respondError(w, http.StatusInternalServerError, "failed to list messages")
		return
	}

	respondJSON(w, http.StatusOK, messages)
}

// PostMessage handles POST /api/channels/{id}/messages.
func (h *Handlers) PostMessage(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	channelID, err := primitive.ObjectIDFromHex(vars["id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	var req struct {
		Content  string `json:"content"`
		ThreadID string `json:"thread_id,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(req.Content) == "" {
		respondError(w, http.StatusBadRequest, "message content is required")
		return
	}

	author := getAuthor(r)

	// Parse @mentions from the content.
	matches := mentionRe.FindAllStringSubmatch(req.Content, -1)
	mentionSet := make(map[string]bool)
	for _, m := range matches {
		mentionSet[m[1]] = true
	}
	mentions := make([]string, 0, len(mentionSet))
	for m := range mentionSet {
		mentions = append(mentions, m)
	}

	msg := &models.Message{
		ChannelID: channelID,
		Author:    author,
		Content:   req.Content,
		Mentions:  mentions,
	}

	if req.ThreadID != "" {
		tid, err := primitive.ObjectIDFromHex(req.ThreadID)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid thread_id")
			return
		}
		msg.ThreadID = &tid
	}

	if err := h.Store.CreateMessage(r.Context(), msg); err != nil {
		log.Printf("handler: create message: %v", err)
		respondError(w, http.StatusInternalServerError, "failed to create message")
		return
	}

	// Audit entry.
	h.Store.CreateAuditEntry(r.Context(), &models.AuditEntry{
		Actor:  author,
		Action: "message.post",
		Details: map[string]any{
			"channel_id": channelID.Hex(),
			"message_id": msg.ID.Hex(),
			"mentions":   mentions,
		},
	})

	// Broadcast over WebSocket.
	payload, err := json.Marshal(msg)
	if err == nil {
		h.Hub.Broadcast(channelID.Hex(), payload)
	}

	respondJSON(w, http.StatusCreated, msg)
}

// ListThreads handles GET /api/channels/{id}/threads.
func (h *Handlers) ListThreads(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	channelID, err := primitive.ObjectIDFromHex(vars["id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	roots, err := h.Store.ListThreadRoots(r.Context(), channelID)
	if err != nil {
		log.Printf("handler: list threads: %v", err)
		respondError(w, http.StatusInternalServerError, "failed to list threads")
		return
	}

	respondJSON(w, http.StatusOK, roots)
}

// ---------------------------------------------------------------------------
// Mentions handler
// ---------------------------------------------------------------------------

// GetMentions handles GET /api/mentions.
func (h *Handlers) GetMentions(w http.ResponseWriter, r *http.Request) {
	author := getAuthor(r)

	since := time.Now().Add(-24 * time.Hour) // Default: last 24 hours.
	if sinceStr := r.URL.Query().Get("since"); sinceStr != "" {
		t, err := time.Parse(time.RFC3339, sinceStr)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid since parameter, use RFC3339 format")
			return
		}
		since = t
	}

	messages, err := h.Store.GetMentionsSince(r.Context(), author, since)
	if err != nil {
		log.Printf("handler: get mentions: %v", err)
		respondError(w, http.StatusInternalServerError, "failed to get mentions")
		return
	}

	respondJSON(w, http.StatusOK, messages)
}

// ---------------------------------------------------------------------------
// Audit handler
// ---------------------------------------------------------------------------

// ListAudit handles GET /api/audit.
func (h *Handlers) ListAudit(w http.ResponseWriter, r *http.Request) {
	actor := r.URL.Query().Get("actor")

	var since *time.Time
	if sinceStr := r.URL.Query().Get("since"); sinceStr != "" {
		t, err := time.Parse(time.RFC3339, sinceStr)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid since parameter, use RFC3339 format")
			return
		}
		since = &t
	}

	limit := int64(100)
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		l, err := strconv.ParseInt(limitStr, 10, 64)
		if err == nil && l > 0 {
			limit = l
		}
	}

	entries, err := h.Store.ListAuditEntries(r.Context(), actor, since, limit)
	if err != nil {
		log.Printf("handler: list audit: %v", err)
		respondError(w, http.StatusInternalServerError, "failed to list audit entries")
		return
	}

	respondJSON(w, http.StatusOK, entries)
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

// HealthCheck handles GET /health.
func (h *Handlers) HealthCheck(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

// HandleWebSocket handles GET /ws.
func (h *Handlers) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	ws.ServeWs(h.Hub, w, r)
}
