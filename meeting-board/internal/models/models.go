package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Channel represents a communication channel on the meeting board.
// All bot-to-bot communication flows through channels — never directly.
type Channel struct {
	ID          primitive.ObjectID `json:"id" bson:"_id,omitempty"`
	Name        string             `json:"name" bson:"name"`
	Description string             `json:"description" bson:"description"`
	CreatedAt   time.Time          `json:"created_at" bson:"created_at"`
}

// Message represents a single message posted to a channel.
// Messages may optionally belong to a thread (identified by ThreadID).
type Message struct {
	ID        primitive.ObjectID  `json:"id" bson:"_id,omitempty"`
	ChannelID primitive.ObjectID  `json:"channel_id" bson:"channel_id"`
	ThreadID  *primitive.ObjectID `json:"thread_id,omitempty" bson:"thread_id,omitempty"`
	Author    string              `json:"author" bson:"author"`
	Content   string              `json:"content" bson:"content"`
	Mentions  []string            `json:"mentions" bson:"mentions"`
	CreatedAt time.Time           `json:"created_at" bson:"created_at"`
}

// AuditEntry records an action taken on the meeting board for traceability.
type AuditEntry struct {
	ID        primitive.ObjectID `json:"id" bson:"_id,omitempty"`
	Actor     string             `json:"actor" bson:"actor"`
	Action    string             `json:"action" bson:"action"`
	Details   map[string]any     `json:"details" bson:"details"`
	Timestamp time.Time          `json:"timestamp" bson:"timestamp"`
}
