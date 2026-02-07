package main

import (
	"context"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/devteam/meeting-board/internal/models"
	"github.com/devteam/meeting-board/internal/server"
	"github.com/devteam/meeting-board/internal/store"
	"github.com/devteam/meeting-board/internal/ws"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

//go:embed web/templates/*
var webContent embed.FS

func main() {
	// -----------------------------------------------------------------------
	// Configuration from environment variables.
	// -----------------------------------------------------------------------
	mongoURI := envOrDefault("MONGO_URI", "mongodb://mongo:27017")
	dbName := envOrDefault("DB_NAME", "meetingboard")
	port := envOrDefault("PORT", "8080")
	authTokensRaw := envOrDefault("AUTH_TOKENS", "po:token1,dev:token2,cq:token3,qa:token4,ops:token5")
	agentsRegistryPath := os.Getenv("AGENTS_REGISTRY")

	tokens := parseAuthTokens(authTokensRaw)
	log.Printf("Loaded %d auth tokens", len(tokens))

	// Load agents from registry file if provided.
	agents := loadAgentsRegistry(agentsRegistryPath)

	// -----------------------------------------------------------------------
	// MongoDB connection.
	// -----------------------------------------------------------------------
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	clientOpts := options.Client().ApplyURI(mongoURI)
	mongoClient, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		log.Fatalf("Failed to connect to MongoDB: %v", err)
	}
	defer func() {
		if err := mongoClient.Disconnect(context.Background()); err != nil {
			log.Printf("Error disconnecting from MongoDB: %v", err)
		}
	}()

	if err := mongoClient.Ping(ctx, nil); err != nil {
		log.Fatalf("Failed to ping MongoDB: %v", err)
	}
	log.Println("Connected to MongoDB")

	db := mongoClient.Database(dbName)
	st := store.NewStore(db)

	// -----------------------------------------------------------------------
	// Seed default channels.
	// -----------------------------------------------------------------------
	seedChannels(st)

	// -----------------------------------------------------------------------
	// WebSocket hub.
	// -----------------------------------------------------------------------
	hub := ws.NewHub()
	go hub.Run()

	// -----------------------------------------------------------------------
	// HTTP server.
	// -----------------------------------------------------------------------
	webFS, err := fs.Sub(webContent, "web/templates")
	if err != nil {
		log.Fatalf("Failed to create sub filesystem for web templates: %v", err)
	}

	router := server.NewServer(st, hub, tokens, agents, webFS)

	log.Printf("Meeting Board starting on :%s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// envOrDefault returns the value of the environment variable or the default if unset/empty.
func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

// parseAuthTokens parses a comma-separated string of "role:token" pairs into a map.
func parseAuthTokens(raw string) map[string]string {
	tokens := make(map[string]string)
	for _, pair := range strings.Split(raw, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		parts := strings.SplitN(pair, ":", 2)
		if len(parts) == 2 {
			role := strings.TrimSpace(parts[0])
			token := strings.TrimSpace(parts[1])
			if role != "" && token != "" {
				tokens[role] = token
			}
		}
	}
	return tokens
}

// loadAgentsRegistry reads the agents-registry.json file and returns a slice
// of AgentInfo. Returns nil if the file is not set or cannot be read.
func loadAgentsRegistry(path string) []models.AgentInfo {
	if path == "" {
		return nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		log.Printf("Warning: could not read agents registry at %s: %v", path, err)
		return nil
	}

	var agents []models.AgentInfo
	if err := json.Unmarshal(data, &agents); err != nil {
		log.Printf("Warning: could not parse agents registry at %s: %v", path, err)
		return nil
	}

	log.Printf("Loaded %d agents from registry: %s", len(agents), path)
	return agents
}

// seedChannels creates the default channels if they do not already exist.
func seedChannels(st *store.Store) {
	defaults := []struct {
		name string
		desc string
	}{
		{"standup", "Daily standup updates and status reports"},
		{"planning", "Sprint planning and task breakdown discussions"},
		{"review", "Code review requests and feedback"},
		{"retrospective", "Sprint retrospective discussions and action items"},
		{"ad-hoc", "General discussion and ad-hoc communication"},
		{"humans", "Communication channel between PO and human stakeholders"},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for _, d := range defaults {
		existing, _ := st.GetChannelByName(ctx, d.name)
		if existing != nil {
			continue
		}

		ch := &models.Channel{
			Name:        d.name,
			Description: d.desc,
		}
		if err := st.CreateChannel(ctx, ch); err != nil {
			// Ignore duplicate key errors from race conditions.
			if !strings.Contains(err.Error(), "duplicate key") {
				log.Printf("Failed to seed channel %q: %v", d.name, err)
			}
		} else {
			log.Printf("Seeded channel: %s", d.name)
		}
	}
}
