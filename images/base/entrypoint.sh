#!/bin/bash
set -euo pipefail

# =============================================================================
# DevTeam Base Image Entrypoint
# =============================================================================
# 3-Layer Configuration Merge:
#   Layer 1: Base config     — /home/agent/.openclaw/config.json (baked into image)
#   Layer 2: Persona config  — /home/agent/persona/              (copied in persona Dockerfiles)
#   Layer 3: Runtime overrides — /overrides/                     (volume-mounted at runtime)
# =============================================================================

CONFIG_DIR="/home/agent/.openclaw"
CONFIG_FILE="${CONFIG_DIR}/agent-config.json"
WORKSPACE_DIR="/home/agent/workspace"
PERSONA_DIR="/home/agent/persona"
OVERRIDES_DIR="/overrides"

LOG_PREFIX="[entrypoint]"

log() {
    echo "${LOG_PREFIX} $(date '+%Y-%m-%d %H:%M:%S') $*"
}

log_error() {
    echo "${LOG_PREFIX} ERROR: $(date '+%Y-%m-%d %H:%M:%S') $*" >&2
}

# -----------------------------------------------------------------------------
# Deep-merge two JSON files using jq.
# Usage: deep_merge <base.json> <overlay.json>
# Prints merged JSON to stdout. Objects are recursively merged; arrays and
# scalars in the overlay replace those in the base.
# -----------------------------------------------------------------------------
deep_merge() {
    local base_file="$1"
    local overlay_file="$2"

    if [ ! -f "$base_file" ]; then
        log_error "Base file not found: ${base_file}"
        return 1
    fi

    if [ ! -f "$overlay_file" ]; then
        # Nothing to merge — return base unchanged
        cat "$base_file"
        return 0
    fi

    jq -s '
        def deepmerge(a; b):
            a as $a | b as $b |
            if ($a | type) == "object" and ($b | type) == "object" then
                ($a | keys_unsorted) + ($b | keys_unsorted) | unique |
                map(. as $key |
                    if ($a | has($key)) and ($b | has($key)) then
                        { ($key): deepmerge($a[$key]; $b[$key]) }
                    elif ($b | has($key)) then
                        { ($key): $b[$key] }
                    else
                        { ($key): $a[$key] }
                    end
                ) | add // {}
            else
                $b
            end;
        deepmerge(.[0]; .[1])
    ' "$base_file" "$overlay_file"
}

# -----------------------------------------------------------------------------
# Layer 1: Base config is already at CONFIG_FILE from the Docker image build.
# Validate it exists and is valid JSON.
# -----------------------------------------------------------------------------
log "Layer 1: Validating base config at ${CONFIG_FILE}"

if [ ! -f "$CONFIG_FILE" ]; then
    log_error "Base config missing at ${CONFIG_FILE}. Image may be corrupted."
    exit 1
fi

if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
    log_error "Base config is not valid JSON."
    exit 1
fi

log "Layer 1: Base config OK"

# -----------------------------------------------------------------------------
# Layer 2: Persona config (copied into image by persona Dockerfiles)
# - Workspace files: SOUL.md, HEARTBEAT.md, IDENTITY.md, TOOLS.md
# - Config overlay:  persona/openclaw.json
# -----------------------------------------------------------------------------
log "Layer 2: Applying persona configuration from ${PERSONA_DIR}"

PERSONA_WORKSPACE_FILES=("SOUL.md" "HEARTBEAT.md" "IDENTITY.md" "TOOLS.md")
OPENCLAW_WORKSPACE="${CONFIG_DIR}/workspace"

if [ -d "$PERSONA_DIR" ]; then
    # Copy persona workspace files into BOTH the agent workspace and OpenClaw's
    # own workspace (~/.openclaw/workspace/) which is where it actually reads them.
    # Persona Dockerfiles place files under persona/workspace/, so check there first.
    mkdir -p "$OPENCLAW_WORKSPACE"
    for fname in "${PERSONA_WORKSPACE_FILES[@]}"; do
        src=""
        if [ -f "${PERSONA_DIR}/workspace/${fname}" ]; then
            src="${PERSONA_DIR}/workspace/${fname}"
        elif [ -f "${PERSONA_DIR}/${fname}" ]; then
            src="${PERSONA_DIR}/${fname}"
        fi
        if [ -n "$src" ]; then
            cp "$src" "${WORKSPACE_DIR}/${fname}"
            cp "$src" "${OPENCLAW_WORKSPACE}/${fname}"
            log "  Copied persona file: ${fname}"
        fi
    done

    # Copy skills into OpenClaw workspace so the agent can discover them
    if [ -d "${PERSONA_DIR}/skills" ]; then
        mkdir -p "${OPENCLAW_WORKSPACE}/skills"
        cp -r "${PERSONA_DIR}/skills/"* "${OPENCLAW_WORKSPACE}/skills/" 2>/dev/null || true
        log "  Copied skills directory to OpenClaw workspace"
    fi

    # Deep-merge persona openclaw.json on top of base config
    if [ -f "${PERSONA_DIR}/openclaw.json" ]; then
        log "  Merging persona openclaw.json into config"
        MERGED=$(deep_merge "$CONFIG_FILE" "${PERSONA_DIR}/openclaw.json")
        if [ $? -eq 0 ] && [ -n "$MERGED" ]; then
            echo "$MERGED" | jq '.' > "${CONFIG_FILE}.tmp"
            mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
            log "  Persona config merged successfully"
        else
            log_error "  Failed to merge persona config. Continuing with base config."
        fi
    else
        log "  No persona openclaw.json found, skipping config merge"
    fi
else
    log "  No persona directory found at ${PERSONA_DIR}, skipping Layer 2"
fi

# -----------------------------------------------------------------------------
# Layer 3: Runtime overrides (volume-mounted at /overrides/)
# - Workspace files override persona files
# - openclaw.json merges on top of current config
# -----------------------------------------------------------------------------
log "Layer 3: Applying runtime overrides from ${OVERRIDES_DIR}"

if [ -d "${OVERRIDES_DIR}/workspace" ]; then
    # Copy all files from overrides workspace into agent workspace
    for fpath in "${OVERRIDES_DIR}/workspace/"*; do
        if [ -f "$fpath" ]; then
            fname=$(basename "$fpath")
            cp "$fpath" "${WORKSPACE_DIR}/${fname}"
            log "  Override workspace file: ${fname}"
        fi
    done
else
    log "  No runtime workspace overrides found"
fi

if [ -f "${OVERRIDES_DIR}/openclaw.json" ]; then
    log "  Merging runtime openclaw.json into config"
    MERGED=$(deep_merge "$CONFIG_FILE" "${OVERRIDES_DIR}/openclaw.json")
    if [ $? -eq 0 ] && [ -n "$MERGED" ]; then
        echo "$MERGED" | jq '.' > "${CONFIG_FILE}.tmp"
        mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        log "  Runtime config merged successfully"
    else
        log_error "  Failed to merge runtime config. Continuing with current config."
    fi
else
    log "  No runtime openclaw.json found, skipping config merge"
fi

# -----------------------------------------------------------------------------
# Environment variable injection
# Replaces ${VAR_NAME} placeholders and also sets top-level keys as needed.
# -----------------------------------------------------------------------------
log "Injecting environment variables into config"

inject_env_var() {
    local var_name="$1"
    local var_value="${!var_name:-}"

    if [ -n "$var_value" ]; then
        # Replace ${VAR_NAME} placeholder strings within the JSON (string values)
        local placeholder="\${${var_name}}"
        if grep -q "$placeholder" "$CONFIG_FILE" 2>/dev/null; then
            # Use jq to do safe string replacement inside all string values
            UPDATED=$(jq --arg placeholder "\${${var_name}}" --arg value "$var_value" '
                walk(if type == "string" then gsub($placeholder; $value) else . end)
            ' "$CONFIG_FILE")
            echo "$UPDATED" > "${CONFIG_FILE}.tmp"
            mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
            log "  Injected \${${var_name}} into config placeholders"
        fi
    fi
}

# Also handle default-value placeholders like ${VAR:-default}
inject_env_with_defaults() {
    local var_name="$1"
    local var_value="${!var_name:-}"

    # Match patterns like ${VAR_NAME:-some_default}
    local pattern="\\\$\\{${var_name}:-[^}]*\\}"

    if grep -qE "\\\$\{${var_name}:-" "$CONFIG_FILE" 2>/dev/null; then
        if [ -n "$var_value" ]; then
            # Environment variable is set — replace entire ${VAR:-default} with the value
            UPDATED=$(jq --arg varname "${var_name}" --arg value "$var_value" '
                walk(
                    if type == "string" then
                        if test("\\$\\{" + $varname + ":-[^}]*\\}") then
                            capture("(?<before>.*?)\\$\\{" + $varname + ":-(?<default>[^}]*)\\}(?<after>.*)") |
                            .before + $value + .after
                        else .
                        end
                    else .
                    end
                )
            ' "$CONFIG_FILE")
            echo "$UPDATED" > "${CONFIG_FILE}.tmp"
            mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
            log "  Injected ${var_name}=${var_value} (overriding default)"
        else
            # Environment variable is NOT set — replace with the default value
            UPDATED=$(jq --arg varname "${var_name}" '
                walk(
                    if type == "string" then
                        if test("\\$\\{" + $varname + ":-[^}]*\\}") then
                            capture("(?<before>.*?)\\$\\{" + $varname + ":-(?<default>[^}]*)\\}(?<after>.*)") |
                            .before + .default + .after
                        else .
                        end
                    else .
                    end
                )
            ' "$CONFIG_FILE")
            echo "$UPDATED" > "${CONFIG_FILE}.tmp"
            mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
            log "  Resolved ${var_name} to default value"
        fi
    fi

    # Also handle the simple ${VAR} form (no default)
    inject_env_var "$var_name"
}

# Process all known environment variables
inject_env_with_defaults "MEETING_BOARD_URL"
inject_env_with_defaults "MEETING_BOARD_TOKEN"
inject_env_with_defaults "PLANNING_BOARD_URL"
inject_env_with_defaults "PLANNING_BOARD_TOKEN"
inject_env_var "ANTHROPIC_API_KEY"
inject_env_var "XAI_API_KEY"
inject_env_var "OPENAI_API_KEY"
inject_env_with_defaults "HUMAN_COMMS_TYPE"
inject_env_var "HUMAN_COMMS_WEBHOOK_URL"

# If API keys are set but not already in the config, inject them at the top level
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    UPDATED=$(jq --arg key "$ANTHROPIC_API_KEY" '.api_keys.anthropic = $key' "$CONFIG_FILE")
    echo "$UPDATED" > "${CONFIG_FILE}.tmp"
    mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    log "  Set api_keys.anthropic from ANTHROPIC_API_KEY"
fi

if [ -n "${XAI_API_KEY:-}" ]; then
    UPDATED=$(jq --arg key "$XAI_API_KEY" '.api_keys.xai = $key' "$CONFIG_FILE")
    echo "$UPDATED" > "${CONFIG_FILE}.tmp"
    mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    log "  Set api_keys.xai from XAI_API_KEY"
fi

if [ -n "${OPENAI_API_KEY:-}" ]; then
    UPDATED=$(jq --arg key "$OPENAI_API_KEY" '.api_keys.openai = $key' "$CONFIG_FILE")
    echo "$UPDATED" > "${CONFIG_FILE}.tmp"
    mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    log "  Set api_keys.openai from OPENAI_API_KEY"
fi

# -----------------------------------------------------------------------------
# Final config validation
# -----------------------------------------------------------------------------
log "Final config validation"

if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
    log_error "Final config is not valid JSON! Dumping contents:"
    cat "$CONFIG_FILE" >&2
    exit 1
fi

log "Final config is valid. Contents:"
jq '.' "$CONFIG_FILE"

# -----------------------------------------------------------------------------
# Wait for dependent services
# -----------------------------------------------------------------------------
MEETING_BOARD_URL_RESOLVED=$(jq -r '.integrations.meeting_board.url // empty' "$CONFIG_FILE")

if [ -n "$MEETING_BOARD_URL_RESOLVED" ]; then
    # Extract host:port from URL
    MB_HOST=$(echo "$MEETING_BOARD_URL_RESOLVED" | sed -E 's|https?://||' | sed -E 's|/.*||')
    MB_HOSTNAME=$(echo "$MB_HOST" | cut -d: -f1)
    MB_PORT=$(echo "$MB_HOST" | grep -o ':[0-9]*' | tr -d ':')
    MB_PORT=${MB_PORT:-8080}

    log "Waiting for Meeting Board at ${MB_HOSTNAME}:${MB_PORT} ..."
    if /usr/local/bin/wait-for-it.sh "${MB_HOSTNAME}:${MB_PORT}" -t "${MEETING_BOARD_WAIT_TIMEOUT:-60}"; then
        log "Meeting Board is available"
    else
        log_error "Meeting Board at ${MB_HOSTNAME}:${MB_PORT} did not become available within timeout."
        log_error "Proceeding anyway — agent will retry connections at runtime."
    fi
else
    log "No meeting_board URL configured, skipping service wait"
fi

# -----------------------------------------------------------------------------
# Generate OpenClaw gateway config (openclaw.json)
# The agent-config.json is our devteam config; openclaw.json is what OpenClaw reads.
# -----------------------------------------------------------------------------
OPENCLAW_CONFIG="${CONFIG_DIR}/openclaw.json"
# AGENT_INSTANCE env var (set by generated compose) takes priority over config file
if [ -n "${AGENT_INSTANCE:-}" ]; then
    AGENT_NAME="${AGENT_NAME:-${AGENT_INSTANCE}}"
else
    AGENT_NAME=$(jq -r '.name // "devteam-agent"' "$CONFIG_FILE")
fi
GW_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
GW_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"

log "Generating OpenClaw gateway config for agent: ${AGENT_NAME}"

# Extract model from persona config (e.g., "xai/grok-3" from provider.name + provider.model)
PROVIDER_NAME=$(jq -r '.provider.name // empty' "$CONFIG_FILE")
PROVIDER_MODEL=$(jq -r '.provider.model // empty' "$CONFIG_FILE")
if [ -n "$PROVIDER_NAME" ] && [ -n "$PROVIDER_MODEL" ]; then
    AGENT_MODEL="${PROVIDER_NAME}/${PROVIDER_MODEL}"
else
    AGENT_MODEL=""
fi

# Build gateway config — OpenClaw validates against a Zod schema, so only known keys
jq -n \
    --argjson port "$GW_PORT" \
    --arg bind "${OPENCLAW_GATEWAY_BIND:-lan}" \
    --arg token "$GW_TOKEN" \
    --arg model "$AGENT_MODEL" \
    '{
        gateway: {
            mode: "local",
            port: $port,
            bind: $bind
        }
    }
    | if $token != "" then .gateway.auth = { mode: "token", token: $token } else . end
    | if $model != "" then .agents = { defaults: { model: { primary: $model }, heartbeat: { prompt: "You were woken by a mention or heartbeat. Use the read tool to load HEARTBEAT.md from the current directory. Then follow its instructions strictly. When responding to an @mention, you MUST use the exec tool to run curl commands to post your response back to the Meeting Board API. Never respond with plain text only — always post via the API. If nothing needs attention, reply HEARTBEAT_OK." } } } else . end
    ' > "$OPENCLAW_CONFIG"

# Generate auth-profiles.json for the AI provider API key
AUTH_PROFILES="${CONFIG_DIR}/auth-profiles.json"
if [ -n "$PROVIDER_NAME" ]; then
    log "Setting up auth profile for provider: ${PROVIDER_NAME}"

    # Determine which API key env var to use
    API_KEY_ENV=$(jq -r '.provider.api_key_env // empty' "$CONFIG_FILE")
    API_KEY_VALUE=""
    if [ -n "$API_KEY_ENV" ]; then
        API_KEY_VALUE="${!API_KEY_ENV:-}"
    fi

    if [ -n "$API_KEY_VALUE" ]; then
        jq -n \
            --arg provider "$PROVIDER_NAME" \
            --arg key "$API_KEY_VALUE" \
            '{ ($provider): { type: "api-key", key: $key } }' > "$AUTH_PROFILES"
        log "  Auth profile created for ${PROVIDER_NAME}"
    else
        log "  No API key found for ${PROVIDER_NAME} (env: ${API_KEY_ENV})"
    fi
fi

# Validate generated config
if ! jq empty "$OPENCLAW_CONFIG" 2>/dev/null; then
    log_error "Generated openclaw.json is not valid JSON! Dumping:"
    cat "$OPENCLAW_CONFIG" >&2
    exit 1
fi

log "OpenClaw gateway config:"
jq '.' "$OPENCLAW_CONFIG"

# Save merged devteam config to workspace for agent reference
cp "$CONFIG_FILE" "${WORKSPACE_DIR}/.agent-config.json" 2>/dev/null || true

# -----------------------------------------------------------------------------
# Background daemon: post-init workspace sync + device auto-approval
# -----------------------------------------------------------------------------
# 1. After gateway init, re-copy persona files to OpenClaw's workspace in case
#    the gateway overwrote them with blank templates during its setup.
# 2. Auto-approve pending device pairing requests so the router service, webchat
#    UI, and other WebSocket clients work without manual `openclaw devices approve`.
DEVICES_DIR="${CONFIG_DIR}/devices"
mkdir -p "$DEVICES_DIR"
(
    sleep 10  # Give the gateway time to fully initialize

    # Re-copy persona workspace files (overwrites any blank templates)
    if [ -d "$PERSONA_DIR" ]; then
        for fname in SOUL.md HEARTBEAT.md IDENTITY.md TOOLS.md; do
            src=""
            if [ -f "${PERSONA_DIR}/workspace/${fname}" ]; then
                src="${PERSONA_DIR}/workspace/${fname}"
            elif [ -f "${PERSONA_DIR}/${fname}" ]; then
                src="${PERSONA_DIR}/${fname}"
            fi
            if [ -n "$src" ] && [ -d "${CONFIG_DIR}/workspace" ]; then
                cp "$src" "${CONFIG_DIR}/workspace/${fname}"
            fi
        done
        if [ -d "${PERSONA_DIR}/skills" ] && [ -d "${CONFIG_DIR}/workspace" ]; then
            mkdir -p "${CONFIG_DIR}/workspace/skills"
            cp -r "${PERSONA_DIR}/skills/"* "${CONFIG_DIR}/workspace/skills/" 2>/dev/null || true
        fi
        log "[post-init] Persona files synced to OpenClaw workspace"
    fi

    # Auto-approve loop
    while true; do
        if [ -f "${DEVICES_DIR}/pending.json" ]; then
            pending_count=$(jq 'length' "${DEVICES_DIR}/pending.json" 2>/dev/null || echo "0")
            if [ "$pending_count" != "0" ] && [ -n "$pending_count" ]; then
                for did in $(jq -r 'keys[]' "${DEVICES_DIR}/pending.json" 2>/dev/null); do
                    if [ -n "$did" ] && [ "$did" != "null" ]; then
                        log "[auto-approve] Approving device ${did}"
                        OPENCLAW_STATE_DIR="${CONFIG_DIR}" openclaw devices approve "$did" 2>/dev/null || true
                    fi
                done
            fi
        fi
        sleep 5
    done
) &
log "Started background daemon (post-init sync + device auto-approve, PID: $!)"

# -----------------------------------------------------------------------------
# Start OpenClaw Gateway
# -----------------------------------------------------------------------------
log "Starting OpenClaw gateway..."
log "Agent: ${AGENT_NAME}"

# Export env vars that OpenClaw reads directly
export OPENCLAW_STATE_DIR="${CONFIG_DIR}"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG}"
export OPENCLAW_NO_ONBOARD=1

# If additional args are passed to the container, forward them
if [ $# -gt 0 ]; then
    log "Additional arguments: $*"
    exec openclaw gateway \
        --port "$GW_PORT" \
        --allow-unconfigured \
        "$@"
else
    exec openclaw gateway \
        --port "$GW_PORT" \
        --allow-unconfigured
fi
