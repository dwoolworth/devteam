package server

import (
	"bufio"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/devteam/meeting-board/internal/handlers"
	"github.com/devteam/meeting-board/internal/models"
	"github.com/devteam/meeting-board/internal/store"
	"github.com/devteam/meeting-board/internal/ws"
	"github.com/gorilla/mux"
)

// NewServer creates and configures a mux.Router with all routes, middleware, and the
// embedded web dashboard.
func NewServer(st *store.Store, hub *ws.Hub, tokens map[string]string, agents []models.AgentInfo, webFS fs.FS) *mux.Router {
	h := &handlers.Handlers{
		Store:  st,
		Hub:    hub,
		Tokens: tokens,
	}

	// Initialize agent registry if provided.
	if len(agents) > 0 {
		h.SetAgents(agents)
		log.Printf("Loaded %d agents into registry", len(agents))
	}

	r := mux.NewRouter()

	// Global middleware.
	r.Use(corsMiddleware)
	r.Use(loggingMiddleware)

	// Health check (no auth required).
	r.HandleFunc("/health", h.HealthCheck).Methods("GET")

	// WebSocket endpoint (no auth required; subscriptions are public).
	r.HandleFunc("/ws", h.HandleWebSocket).Methods("GET")

	// API routes with auth middleware.
	api := r.PathPrefix("/api").Subrouter()
	api.Use(h.AuthMiddleware)

	api.HandleFunc("/channels", h.ListChannels).Methods("GET")
	api.HandleFunc("/channels", h.CreateChannel).Methods("POST")
	api.HandleFunc("/channels/{id}/messages", h.ListMessages).Methods("GET")
	api.HandleFunc("/channels/{id}/messages", h.PostMessage).Methods("POST")
	api.HandleFunc("/channels/{id}/messages", h.ClearChannel).Methods("DELETE")
	api.HandleFunc("/channels/{id}/threads", h.ListThreads).Methods("GET")
	api.HandleFunc("/messages", h.ListMessagesByName).Methods("GET")
	api.HandleFunc("/messages", h.PostMessageByName).Methods("POST")
	api.HandleFunc("/mentions", h.GetMentions).Methods("GET")
	api.HandleFunc("/audit", h.ListAudit).Methods("GET")
	api.HandleFunc("/agents", h.ListAgentsAPI).Methods("GET")

	// Serve the embedded web dashboard at /.
	if webFS != nil {
		fileServer := http.FileServer(http.FS(webFS))
		r.PathPrefix("/").Handler(fileServer)
	}

	return r
}

// corsMiddleware adds permissive CORS headers for development.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// loggingMiddleware logs each incoming request with method, path, status, and duration.
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rw.statusCode, time.Since(start))
	})
}

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// Hijack implements http.Hijacker so WebSocket upgrades work through the logging middleware.
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
	}
	return h.Hijack()
}
