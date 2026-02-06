package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development and embedded dashboard.
	},
}

// clientAction represents a JSON message sent by a WebSocket client.
type clientAction struct {
	Action  string `json:"action"`
	Channel string `json:"channel"`
}

// Client represents a single WebSocket connection and its channel subscriptions.
type Client struct {
	hub     *Hub
	conn    *websocket.Conn
	send    chan []byte
	channels map[string]bool
	mu       sync.Mutex
}

// Hub maintains the set of active clients and broadcasts messages to
// clients subscribed to specific channels.
type Hub struct {
	// clients is the set of all registered clients.
	clients map[*Client]bool

	// channelSubs maps channel IDs to sets of subscribed clients.
	channelSubs map[string]map[*Client]bool

	// register channel for new clients.
	register chan *Client

	// unregister channel for departing clients.
	unregister chan *Client

	// broadcast receives a channel-scoped message to be sent to subscribers.
	broadcast chan broadcastMsg

	mu sync.RWMutex
}

// broadcastMsg pairs a channel ID with the raw JSON payload to broadcast.
type broadcastMsg struct {
	channelID string
	data      []byte
}

// NewHub creates and returns a new Hub.
func NewHub() *Hub {
	return &Hub{
		clients:     make(map[*Client]bool),
		channelSubs: make(map[string]map[*Client]bool),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		broadcast:   make(chan broadcastMsg, 256),
	}
}

// Run starts the hub's main event loop. It must be called in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)

				// Remove from all channel subscriptions.
				client.mu.Lock()
				for ch := range client.channels {
					if subs, exists := h.channelSubs[ch]; exists {
						delete(subs, client)
						if len(subs) == 0 {
							delete(h.channelSubs, ch)
						}
					}
				}
				client.mu.Unlock()
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			if subs, ok := h.channelSubs[msg.channelID]; ok {
				for client := range subs {
					select {
					case client.send <- msg.data:
					default:
						// Client's send buffer is full; drop it.
						h.mu.RUnlock()
						h.mu.Lock()
						delete(h.clients, client)
						client.mu.Lock()
						for ch := range client.channels {
							if s, exists := h.channelSubs[ch]; exists {
								delete(s, client)
								if len(s) == 0 {
									delete(h.channelSubs, ch)
								}
							}
						}
						client.mu.Unlock()
						close(client.send)
						h.mu.Unlock()
						h.mu.RLock()
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a message to all clients subscribed to the given channel.
func (h *Hub) Broadcast(channelID string, msg []byte) {
	h.broadcast <- broadcastMsg{channelID: channelID, data: msg}
}

// subscribe adds a client to a channel's subscriber set.
func (h *Hub) subscribe(client *Client, channelID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	client.mu.Lock()
	client.channels[channelID] = true
	client.mu.Unlock()

	if h.channelSubs[channelID] == nil {
		h.channelSubs[channelID] = make(map[*Client]bool)
	}
	h.channelSubs[channelID][client] = true
}

// unsubscribe removes a client from a channel's subscriber set.
func (h *Hub) unsubscribe(client *Client, channelID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	client.mu.Lock()
	delete(client.channels, channelID)
	client.mu.Unlock()

	if subs, ok := h.channelSubs[channelID]; ok {
		delete(subs, client)
		if len(subs) == 0 {
			delete(h.channelSubs, channelID)
		}
	}
}

// readPump pumps messages from the WebSocket connection to the hub.
// It handles subscribe/unsubscribe actions from the client.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("ws: unexpected close error: %v", err)
			}
			break
		}

		var action clientAction
		if err := json.Unmarshal(message, &action); err != nil {
			log.Printf("ws: invalid message from client: %v", err)
			continue
		}

		switch action.Action {
		case "subscribe":
			if action.Channel != "" {
				c.hub.subscribe(c, action.Channel)
			}
		case "unsubscribe":
			if action.Channel != "" {
				c.hub.unsubscribe(c, action.Channel)
			}
		default:
			log.Printf("ws: unknown action: %s", action.Action)
		}
	}
}

// writePump pumps messages from the hub to the WebSocket connection.
func (c *Client) writePump() {
	defer c.conn.Close()

	for message, ok := <-c.send; ok; message, ok = <-c.send {
		w, err := c.conn.NextWriter(websocket.TextMessage)
		if err != nil {
			return
		}
		w.Write(message)
		if err := w.Close(); err != nil {
			return
		}
	}

	// Channel closed; write a close message.
	c.conn.WriteMessage(websocket.CloseMessage, []byte{})
}

// ServeWs handles WebSocket upgrade requests and registers the new client with the hub.
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws: upgrade error: %v", err)
		return
	}

	client := &Client{
		hub:      hub,
		conn:     conn,
		send:     make(chan []byte, 256),
		channels: make(map[string]bool),
	}

	hub.register <- client

	go client.writePump()
	go client.readPump()
}
