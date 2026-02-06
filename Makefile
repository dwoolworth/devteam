.PHONY: help build build-base build-meeting-board build-personas up down logs \
       clean dashboard test-meeting-board push k8s-apply k8s-delete

REGISTRY ?= devteam
TAG ?= latest

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-25s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

build: build-meeting-board build-base build-personas ## Build all images

build-meeting-board: ## Build meeting board image
	docker build -t $(REGISTRY)/meeting-board:$(TAG) ./meeting-board

build-base: ## Build base agent image
	docker build -t $(REGISTRY)/base:$(TAG) ./images/base

build-personas: build-base ## Build all persona images (requires base)
	docker build -t $(REGISTRY)/po:$(TAG)  ./images/po
	docker build -t $(REGISTRY)/dev:$(TAG) ./images/dev
	docker build -t $(REGISTRY)/cq:$(TAG)  ./images/cq
	docker build -t $(REGISTRY)/qa:$(TAG)  ./images/qa
	docker build -t $(REGISTRY)/ops:$(TAG) ./images/ops

build-po: build-base ## Build PO image
	docker build -t $(REGISTRY)/po:$(TAG) ./images/po

build-dev: build-base ## Build DEV image
	docker build -t $(REGISTRY)/dev:$(TAG) ./images/dev

build-cq: build-base ## Build CQ image
	docker build -t $(REGISTRY)/cq:$(TAG) ./images/cq

build-qa: build-base ## Build QA image
	docker build -t $(REGISTRY)/qa:$(TAG) ./images/qa

build-ops: build-base ## Build OPS image
	docker build -t $(REGISTRY)/ops:$(TAG) ./images/ops

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

up: ## Start all services
	docker compose up -d

up-infra: ## Start only infrastructure (mongo + meeting board)
	docker compose up -d mongo meeting-board

up-dev: ## Start infra + DEV only (for testing)
	docker compose up -d mongo meeting-board dev

down: ## Stop all services
	docker compose down

restart: down up ## Restart all services

logs: ## Tail logs for all services
	docker compose logs -f

logs-%: ## Tail logs for a specific service (e.g., make logs-dev)
	docker compose logs -f $*

# ---------------------------------------------------------------------------
# Dashboard & Testing
# ---------------------------------------------------------------------------

dashboard: ## Open meeting board dashboard in browser
	open http://localhost:$${MEETING_BOARD_PORT:-8080}

test-meeting-board: ## Quick smoke test of the meeting board API
	@echo "Health check..."
	@curl -sf http://localhost:$${MEETING_BOARD_PORT:-8080}/health | jq .
	@echo "\nChannels..."
	@curl -sf http://localhost:$${MEETING_BOARD_PORT:-8080}/api/channels | jq .
	@echo "\nPosting test message..."
	@curl -sf -X POST http://localhost:$${MEETING_BOARD_PORT:-8080}/api/channels/$$(curl -sf http://localhost:$${MEETING_BOARD_PORT:-8080}/api/channels | jq -r '.[0].id')/messages \
		-H "Content-Type: application/json" \
		-d '{"content": "Test message from Makefile"}' | jq .
	@echo "\nMeeting board is working!"

status: ## Show status of all services
	docker compose ps

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

clean: down ## Stop services and remove volumes
	docker compose down -v
	docker image rm -f $(REGISTRY)/meeting-board:$(TAG) \
		$(REGISTRY)/base:$(TAG) $(REGISTRY)/po:$(TAG) \
		$(REGISTRY)/dev:$(TAG) $(REGISTRY)/cq:$(TAG) \
		$(REGISTRY)/qa:$(TAG) $(REGISTRY)/ops:$(TAG) 2>/dev/null || true

# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------

push: build ## Push all images to registry
	docker push $(REGISTRY)/meeting-board:$(TAG)
	docker push $(REGISTRY)/base:$(TAG)
	docker push $(REGISTRY)/po:$(TAG)
	docker push $(REGISTRY)/dev:$(TAG)
	docker push $(REGISTRY)/cq:$(TAG)
	docker push $(REGISTRY)/qa:$(TAG)
	docker push $(REGISTRY)/ops:$(TAG)

# ---------------------------------------------------------------------------
# Kubernetes
# ---------------------------------------------------------------------------

k8s-apply: ## Apply Kubernetes manifests
	kubectl apply -k k8s/

k8s-delete: ## Delete Kubernetes resources
	kubectl delete -k k8s/

k8s-status: ## Show Kubernetes resource status
	kubectl -n devteam get all
