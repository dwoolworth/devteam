package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/devteam/meeting-board/internal/models"
	"github.com/devteam/meeting-board/internal/store"
	"github.com/devteam/meeting-board/internal/ws"
	"github.com/gorilla/mux"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type contextKey string

const authorKey contextKey = "author"
const authorInfoKey contextKey = "authorInfo"

// Handlers holds the dependencies required by HTTP handler functions.
type Handlers struct {
	Store  *store.Store
	Hub    *ws.Hub
	Tokens map[string]string // role (or agentID) -> bearer token (legacy)

	// Registry-based auth (new)
	mu             sync.RWMutex
	agents         []models.AgentInfo
	tokenToAgent   map[string]*models.AgentInfo
	nameToAgent    map[string]*models.AgentInfo
	mentionRe      *regexp.Regexp
}

// SetAgents updates the agent registry and rebuilds lookup maps.
func (h *Handlers) SetAgents(agents []models.AgentInfo) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.agents = agents
	h.tokenToAgent = make(map[string]*models.AgentInfo, len(agents))
	h.nameToAgent = make(map[string]*models.AgentInfo, len(agents))

	mentionNames := []string{}
	for i := range agents {
		a := &h.agents[i]
		if a.Token != "" {
			h.tokenToAgent[a.Token] = a
		}
		h.nameToAgent[strings.ToLower(a.ID)] = a
		h.nameToAgent[strings.ToLower(a.Name)] = a
		mentionNames = append(mentionNames, regexp.QuoteMeta(strings.ToLower(a.ID)))
		if strings.ToLower(a.Name) != strings.ToLower(a.ID) {
			mentionNames = append(mentionNames, regexp.QuoteMeta(strings.ToLower(a.Name)))
		}
	}

	// Also include legacy role names for backward compat
	for _, role := range []string{"po", "dev", "cq", "qa", "ops"} {
		mentionNames = append(mentionNames, role)
	}

	// Support @everyone
	mentionNames = append(mentionNames, "everyone")

	if len(mentionNames) > 0 {
		pattern := `@(` + strings.Join(mentionNames, "|") + `)`
		h.mentionRe = regexp.MustCompile(`(?i)` + pattern)
	} else {
		h.mentionRe = regexp.MustCompile(`@(po|dev|cq|qa|ops)`)
	}
}

// GetAgents returns the current list of registered agents.
func (h *Handlers) GetAgents() []models.AgentInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()
	result := make([]models.AgentInfo, len(h.agents))
	copy(result, h.agents)
	return result
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
// resolves the author (agent ID or role), and injects it into the request context.
// Dashboard requests (no auth) are treated as "human".
func (h *Handlers) AuthMiddleware(next http.Handler) http.Handler {
	// Build legacy token->role map
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

		// Try registry-based lookup first
		h.mu.RLock()
		agent, agentOk := h.tokenToAgent[token]
		h.mu.RUnlock()

		if agentOk {
			ctx := context.WithValue(r.Context(), authorKey, agent.ID)
			ctx = context.WithValue(ctx, authorInfoKey, agent)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// Fall back to legacy token->role lookup
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

// getAuthorInfo extracts the full AgentInfo from the request context, if available.
func getAuthorInfo(r *http.Request) *models.AgentInfo {
	if info, ok := r.Context().Value(authorInfoKey).(*models.AgentInfo); ok {
		return info
	}
	return nil
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
	authorInfo := getAuthorInfo(r)

	// Parse @mentions from the content using dynamic regex.
	h.mu.RLock()
	mentionRe := h.mentionRe
	h.mu.RUnlock()

	mentionSet := make(map[string]bool)
	if mentionRe != nil {
		matches := mentionRe.FindAllStringSubmatch(req.Content, -1)
		for _, m := range matches {
			mentioned := strings.ToLower(m[1])
			if mentioned == "everyone" {
				// Expand @everyone to all registered agents
				h.mu.RLock()
				for _, agent := range h.agents {
					mentionSet[agent.ID] = true
				}
				h.mu.RUnlock()
			} else {
				// Resolve name to ID if possible
				h.mu.RLock()
				if agent, ok := h.nameToAgent[mentioned]; ok {
					mentionSet[agent.ID] = true
				} else {
					mentionSet[mentioned] = true
				}
				h.mu.RUnlock()
			}
		}
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

	// Set display name and role from registry
	if authorInfo != nil {
		msg.AuthorName = authorInfo.Name
		msg.AuthorRole = authorInfo.Role
	} else if author == "human" {
		msg.AuthorName = "Human"
		msg.AuthorRole = "human"
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

// ClearChannel handles DELETE /api/channels/{id}/messages.
func (h *Handlers) ClearChannel(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	channelID, err := primitive.ObjectIDFromHex(vars["id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	deleted, err := h.Store.DeleteChannelMessages(r.Context(), channelID)
	if err != nil {
		log.Printf("handler: clear channel: %v", err)
		respondError(w, http.StatusInternalServerError, "failed to clear channel")
		return
	}

	author := getAuthor(r)
	h.Store.CreateAuditEntry(r.Context(), &models.AuditEntry{
		Actor:  author,
		Action: "channel.clear",
		Details: map[string]any{
			"channel_id": channelID.Hex(),
			"deleted":    deleted,
		},
	})

	respondJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
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
// Agents handler
// ---------------------------------------------------------------------------

// ListAgentsAPI handles GET /api/agents.
func (h *Handlers) ListAgentsAPI(w http.ResponseWriter, r *http.Request) {
	agents := h.GetAgents()
	type agentResponse struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Role   string `json:"role"`
		Avatar string `json:"avatar"`
	}
	result := make([]agentResponse, len(agents))
	for i, a := range agents {
		result[i] = agentResponse{
			ID:     a.ID,
			Name:   a.Name,
			Role:   a.Role,
			Avatar: a.Avatar,
		}
	}
	respondJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// Convenience message endpoints (resolve channel by name)
// ---------------------------------------------------------------------------

// PostMessageByName handles POST /api/messages.
// Accepts {"channel": "#standup", "content": "..."} or {"channel": "standup", "body": "..."}.
// Resolves the channel name to an ID and creates the message.
func (h *Handlers) PostMessageByName(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Channel  string `json:"channel"`
		Content  string `json:"content"`
		Body     string `json:"body"`
		ThreadID string `json:"thread_id,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Accept both "content" and "body" fields.
	content := req.Content
	if content == "" {
		content = req.Body
	}
	if strings.TrimSpace(content) == "" {
		respondError(w, http.StatusBadRequest, "message content is required (use \"content\" or \"body\" field)")
		return
	}

	if strings.TrimSpace(req.Channel) == "" {
		respondError(w, http.StatusBadRequest, "channel name is required")
		return
	}

	// Strip leading "#" from channel name.
	channelName := strings.TrimPrefix(strings.TrimSpace(req.Channel), "#")

	ch, err := h.Store.GetChannelByName(r.Context(), channelName)
	if err != nil {
		respondError(w, http.StatusNotFound, "channel not found: "+channelName)
		return
	}

	author := getAuthor(r)
	authorInfo := getAuthorInfo(r)

	// Parse @mentions from the content.
	h.mu.RLock()
	mentionRe := h.mentionRe
	h.mu.RUnlock()

	mentionSet := make(map[string]bool)
	if mentionRe != nil {
		matches := mentionRe.FindAllStringSubmatch(content, -1)
		for _, m := range matches {
			mentioned := strings.ToLower(m[1])
			if mentioned == "everyone" {
				h.mu.RLock()
				for _, agent := range h.agents {
					mentionSet[agent.ID] = true
				}
				h.mu.RUnlock()
			} else {
				h.mu.RLock()
				if agent, ok := h.nameToAgent[mentioned]; ok {
					mentionSet[agent.ID] = true
				} else {
					mentionSet[mentioned] = true
				}
				h.mu.RUnlock()
			}
		}
	}
	mentions := make([]string, 0, len(mentionSet))
	for m := range mentionSet {
		mentions = append(mentions, m)
	}

	msg := &models.Message{
		ChannelID: ch.ID,
		Author:    author,
		Content:   content,
		Mentions:  mentions,
	}

	if authorInfo != nil {
		msg.AuthorName = authorInfo.Name
		msg.AuthorRole = authorInfo.Role
	} else if author == "human" {
		msg.AuthorName = "Human"
		msg.AuthorRole = "human"
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
		log.Printf("handler: create message (by name): %v", err)
		respondError(w, http.StatusInternalServerError, "failed to create message")
		return
	}

	h.Store.CreateAuditEntry(r.Context(), &models.AuditEntry{
		Actor:  author,
		Action: "message.post",
		Details: map[string]any{
			"channel_id":   ch.ID.Hex(),
			"channel_name": ch.Name,
			"message_id":   msg.ID.Hex(),
			"mentions":     mentions,
		},
	})

	payload, err := json.Marshal(msg)
	if err == nil {
		h.Hub.Broadcast(ch.ID.Hex(), payload)
	}

	respondJSON(w, http.StatusCreated, msg)
}

// ListMessagesByName handles GET /api/messages?channel=standup&limit=20&since=...
func (h *Handlers) ListMessagesByName(w http.ResponseWriter, r *http.Request) {
	channelName := strings.TrimPrefix(strings.TrimSpace(r.URL.Query().Get("channel")), "#")
	if channelName == "" {
		respondError(w, http.StatusBadRequest, "channel query parameter is required")
		return
	}

	ch, err := h.Store.GetChannelByName(r.Context(), channelName)
	if err != nil {
		respondError(w, http.StatusNotFound, "channel not found: "+channelName)
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

	messages, err := h.Store.ListMessages(r.Context(), ch.ID, since, limit)
	if err != nil {
		log.Printf("handler: list messages (by name): %v", err)
		respondError(w, http.StatusInternalServerError, "failed to list messages")
		return
	}

	respondJSON(w, http.StatusOK, messages)
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
