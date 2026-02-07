package store

import (
	"context"
	"time"

	"github.com/devteam/meeting-board/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Store provides data access to the MongoDB collections used by the meeting board.
type Store struct {
	db       *mongo.Database
	channels *mongo.Collection
	messages *mongo.Collection
	audit    *mongo.Collection
}

// NewStore creates a new Store and ensures required indexes exist.
func NewStore(db *mongo.Database) *Store {
	s := &Store{
		db:       db,
		channels: db.Collection("channels"),
		messages: db.Collection("messages"),
		audit:    db.Collection("audit"),
	}
	s.ensureIndexes()
	return s
}

// ensureIndexes creates MongoDB indexes for efficient querying.
func (s *Store) ensureIndexes() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Compound index on messages: channel_id + created_at for listing messages by channel in order.
	s.messages.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "channel_id", Value: 1},
			{Key: "created_at", Value: 1},
		},
	})

	// Index on messages.mentions for fast mention lookups.
	s.messages.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "mentions", Value: 1},
		},
	})

	// Index on messages.thread_id for thread queries.
	s.messages.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "thread_id", Value: 1},
		},
	})

	// Index on audit.timestamp for time-range queries on the audit log.
	s.audit.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "timestamp", Value: 1},
		},
	})

	// Unique index on channel name.
	s.channels.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "name", Value: 1},
		},
		Options: options.Index().SetUnique(true),
	})
}

// ---------------------------------------------------------------------------
// Channel operations
// ---------------------------------------------------------------------------

// ListChannels returns all channels ordered by creation time.
func (s *Store) ListChannels(ctx context.Context) ([]models.Channel, error) {
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}})
	cursor, err := s.channels.Find(ctx, bson.M{}, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var channels []models.Channel
	if err := cursor.All(ctx, &channels); err != nil {
		return nil, err
	}
	if channels == nil {
		channels = []models.Channel{}
	}
	return channels, nil
}

// CreateChannel inserts a new channel.
func (s *Store) CreateChannel(ctx context.Context, ch *models.Channel) error {
	ch.CreatedAt = time.Now().UTC()
	res, err := s.channels.InsertOne(ctx, ch)
	if err != nil {
		return err
	}
	ch.ID = res.InsertedID.(primitive.ObjectID)
	return nil
}

// GetChannelByID retrieves a channel by its ObjectID.
func (s *Store) GetChannelByID(ctx context.Context, id primitive.ObjectID) (*models.Channel, error) {
	var ch models.Channel
	err := s.channels.FindOne(ctx, bson.M{"_id": id}).Decode(&ch)
	if err != nil {
		return nil, err
	}
	return &ch, nil
}

// GetChannelByName retrieves a channel by its unique name.
func (s *Store) GetChannelByName(ctx context.Context, name string) (*models.Channel, error) {
	var ch models.Channel
	err := s.channels.FindOne(ctx, bson.M{"name": name}).Decode(&ch)
	if err != nil {
		return nil, err
	}
	return &ch, nil
}

// ---------------------------------------------------------------------------
// Message operations
// ---------------------------------------------------------------------------

// ListMessages returns messages for a channel, optionally filtered by a "since" timestamp,
// with a configurable limit. Results are ordered by created_at ascending.
func (s *Store) ListMessages(ctx context.Context, channelID primitive.ObjectID, since *time.Time, limit int64) ([]models.Message, error) {
	filter := bson.M{"channel_id": channelID, "thread_id": nil}
	if since != nil {
		filter["created_at"] = bson.M{"$gt": *since}
	}

	opts := options.Find().
		SetSort(bson.D{{Key: "created_at", Value: 1}}).
		SetLimit(limit)

	cursor, err := s.messages.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var messages []models.Message
	if err := cursor.All(ctx, &messages); err != nil {
		return nil, err
	}
	if messages == nil {
		messages = []models.Message{}
	}
	return messages, nil
}

// CreateMessage inserts a new message into the messages collection.
func (s *Store) CreateMessage(ctx context.Context, msg *models.Message) error {
	msg.CreatedAt = time.Now().UTC()
	if msg.Mentions == nil {
		msg.Mentions = []string{}
	}
	res, err := s.messages.InsertOne(ctx, msg)
	if err != nil {
		return err
	}
	msg.ID = res.InsertedID.(primitive.ObjectID)
	return nil
}

// DeleteChannelMessages removes all messages in a channel.
// Returns the number of deleted messages.
func (s *Store) DeleteChannelMessages(ctx context.Context, channelID primitive.ObjectID) (int64, error) {
	result, err := s.messages.DeleteMany(ctx, bson.M{"channel_id": channelID})
	if err != nil {
		return 0, err
	}
	return result.DeletedCount, nil
}

// ListThreadMessages returns all messages in a given thread, ordered by created_at ascending.
func (s *Store) ListThreadMessages(ctx context.Context, threadID primitive.ObjectID) ([]models.Message, error) {
	// Include the root message and all replies.
	filter := bson.M{
		"$or": []bson.M{
			{"_id": threadID},
			{"thread_id": threadID},
		},
	}
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}})

	cursor, err := s.messages.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var messages []models.Message
	if err := cursor.All(ctx, &messages); err != nil {
		return nil, err
	}
	if messages == nil {
		messages = []models.Message{}
	}
	return messages, nil
}

// ListThreadRoots returns messages in a channel that have been used as thread roots
// (i.e., messages that have at least one reply).
func (s *Store) ListThreadRoots(ctx context.Context, channelID primitive.ObjectID) ([]models.Message, error) {
	// First find all distinct thread_ids in this channel.
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"channel_id": channelID, "thread_id": bson.M{"$ne": nil}}}},
		{{Key: "$group", Value: bson.M{"_id": "$thread_id"}}},
	}

	cursor, err := s.messages.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var threadIDs []struct {
		ID primitive.ObjectID `bson:"_id"`
	}
	if err := cursor.All(ctx, &threadIDs); err != nil {
		return nil, err
	}

	if len(threadIDs) == 0 {
		return []models.Message{}, nil
	}

	ids := make([]primitive.ObjectID, len(threadIDs))
	for i, t := range threadIDs {
		ids[i] = t.ID
	}

	filter := bson.M{"_id": bson.M{"$in": ids}}
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}})

	rootCursor, err := s.messages.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer rootCursor.Close(ctx)

	var roots []models.Message
	if err := rootCursor.All(ctx, &roots); err != nil {
		return nil, err
	}
	if roots == nil {
		roots = []models.Message{}
	}
	return roots, nil
}

// ---------------------------------------------------------------------------
// Mention operations
// ---------------------------------------------------------------------------

// GetMentionsSince returns messages that mention the given role since the provided timestamp.
func (s *Store) GetMentionsSince(ctx context.Context, role string, since time.Time) ([]models.Message, error) {
	filter := bson.M{
		"mentions":   role,
		"created_at": bson.M{"$gt": since},
	}
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}})

	cursor, err := s.messages.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var messages []models.Message
	if err := cursor.All(ctx, &messages); err != nil {
		return nil, err
	}
	if messages == nil {
		messages = []models.Message{}
	}
	return messages, nil
}

// ---------------------------------------------------------------------------
// Audit operations
// ---------------------------------------------------------------------------

// CreateAuditEntry inserts a new audit entry.
func (s *Store) CreateAuditEntry(ctx context.Context, entry *models.AuditEntry) error {
	entry.Timestamp = time.Now().UTC()
	res, err := s.audit.InsertOne(ctx, entry)
	if err != nil {
		return err
	}
	entry.ID = res.InsertedID.(primitive.ObjectID)
	return nil
}

// ListAuditEntries retrieves audit entries with optional filters for actor and since timestamp.
func (s *Store) ListAuditEntries(ctx context.Context, actor string, since *time.Time, limit int64) ([]models.AuditEntry, error) {
	filter := bson.M{}
	if actor != "" {
		filter["actor"] = actor
	}
	if since != nil {
		filter["timestamp"] = bson.M{"$gt": *since}
	}

	opts := options.Find().
		SetSort(bson.D{{Key: "timestamp", Value: -1}}).
		SetLimit(limit)

	cursor, err := s.audit.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var entries []models.AuditEntry
	if err := cursor.All(ctx, &entries); err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []models.AuditEntry{}
	}
	return entries, nil
}
