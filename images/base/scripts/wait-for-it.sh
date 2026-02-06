#!/bin/bash
# =============================================================================
# wait-for-it.sh — Wait for a host:port to become available
# =============================================================================
# Usage: wait-for-it.sh host:port [-t timeout_seconds]
#
# Polls the given host:port using TCP connection checks until the service
# is available or the timeout expires.
#
# Options:
#   -t, --timeout SECONDS   Maximum time to wait (default: 30)
#   -q, --quiet             Suppress output
#   -s, --strict            Exit with error if timeout is reached
#   -h, --help              Show this help message
#
# Exit codes:
#   0  Service is available
#   1  Timeout reached or invalid arguments
#
# Examples:
#   wait-for-it.sh meeting-board:8080
#   wait-for-it.sh meeting-board:8080 -t 60
#   wait-for-it.sh mongo:27017 -t 120 -s
# =============================================================================

set -euo pipefail

TIMEOUT=30
QUIET=0
STRICT=0
HOST=""
PORT=""

usage() {
    cat <<EOF
Usage: $(basename "$0") host:port [-t timeout] [-q] [-s] [-h]

Wait for a TCP service to become available.

Options:
  -t, --timeout SECONDS   Maximum time to wait (default: 30)
  -q, --quiet             Suppress output
  -s, --strict            Exit with error if timeout is reached
  -h, --help              Show this help message
EOF
    exit 0
}

log() {
    if [ "$QUIET" -eq 0 ]; then
        echo "[wait-for-it] $*"
    fi
}

# Parse host:port from the first positional argument
parse_hostport() {
    local hostport="$1"

    # Handle IPv6 addresses like [::1]:8080
    if [[ "$hostport" == \[* ]]; then
        HOST=$(echo "$hostport" | sed -E 's/^\[([^]]+)\]:?.*$/\1/')
        PORT=$(echo "$hostport" | sed -E 's/^\[[^]]+\]:?//')
    else
        HOST=$(echo "$hostport" | cut -d: -f1)
        PORT=$(echo "$hostport" | cut -d: -f2)
    fi

    if [ -z "$HOST" ] || [ -z "$PORT" ]; then
        echo "Error: Invalid host:port format: ${hostport}" >&2
        echo "Expected format: hostname:port (e.g., meeting-board:8080)" >&2
        exit 1
    fi

    # Validate port is a number
    if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
        echo "Error: Port must be a number, got: ${PORT}" >&2
        exit 1
    fi

    if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
        echo "Error: Port must be between 1 and 65535, got: ${PORT}" >&2
        exit 1
    fi
}

# Check if a TCP connection can be made to host:port
check_tcp() {
    # Try multiple methods in order of preference
    if command -v nc &>/dev/null; then
        nc -z -w 2 "$HOST" "$PORT" &>/dev/null
        return $?
    elif command -v bash &>/dev/null; then
        # Use bash built-in /dev/tcp
        (echo > "/dev/tcp/${HOST}/${PORT}") &>/dev/null
        return $?
    elif command -v curl &>/dev/null; then
        curl -sf --connect-timeout 2 "http://${HOST}:${PORT}" &>/dev/null
        # curl returns 0 on success, 7 on connection refused, 52 on empty reply
        # For our purposes, anything other than connection refused means the port is open
        local rc=$?
        if [ $rc -eq 0 ] || [ $rc -eq 52 ] || [ $rc -eq 56 ]; then
            return 0
        fi
        return 1
    elif command -v wget &>/dev/null; then
        wget -q --spider --timeout=2 "http://${HOST}:${PORT}" &>/dev/null
        local rc=$?
        if [ $rc -eq 0 ] || [ $rc -eq 8 ]; then
            return 0
        fi
        return 1
    else
        echo "Error: No suitable TCP check tool found (need nc, bash /dev/tcp, curl, or wget)" >&2
        exit 1
    fi
}

# --- Argument Parsing ---

if [ $# -eq 0 ]; then
    echo "Error: host:port argument is required" >&2
    usage
fi

# First argument must be host:port
parse_hostport "$1"
shift

# Parse remaining options
while [ $# -gt 0 ]; do
    case "$1" in
        -t|--timeout)
            if [ $# -lt 2 ]; then
                echo "Error: --timeout requires a value" >&2
                exit 1
            fi
            TIMEOUT="$2"
            if ! [[ "$TIMEOUT" =~ ^[0-9]+$ ]]; then
                echo "Error: Timeout must be a positive integer, got: ${TIMEOUT}" >&2
                exit 1
            fi
            shift 2
            ;;
        -q|--quiet)
            QUIET=1
            shift
            ;;
        -s|--strict)
            STRICT=1
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Error: Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# --- Main Wait Loop ---

log "Waiting for ${HOST}:${PORT} (timeout: ${TIMEOUT}s)..."

start_time=$(date +%s)
elapsed=0

while [ "$elapsed" -lt "$TIMEOUT" ]; do
    if check_tcp; then
        log "${HOST}:${PORT} is available after ${elapsed}s"
        exit 0
    fi

    sleep 1
    current_time=$(date +%s)
    elapsed=$((current_time - start_time))

    # Print progress every 10 seconds
    if [ $((elapsed % 10)) -eq 0 ] && [ "$elapsed" -gt 0 ]; then
        log "Still waiting for ${HOST}:${PORT}... (${elapsed}s/${TIMEOUT}s)"
    fi
done

# Timeout reached
log "Timeout reached after ${TIMEOUT}s waiting for ${HOST}:${PORT}"

if [ "$STRICT" -eq 1 ]; then
    log "Strict mode enabled — exiting with error"
    exit 1
fi

# Non-strict mode: warn but exit 0 so the caller can decide what to do
log "Non-strict mode — returning timeout status"
exit 1
