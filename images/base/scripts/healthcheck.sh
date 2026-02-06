#!/bin/bash
# Check if OpenClaw gateway is responding
curl -sf http://localhost:18789/health > /dev/null 2>&1 || exit 1
