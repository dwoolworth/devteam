FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System packages
RUN apt-get update && apt-get install -y \
    curl wget git jq openssh-client build-essential \
    python3 python3-pip ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI (for testing inside containers)
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# OpenClaw - AI agent runtime
RUN npm install -g @anthropic-ai/claude-code@latest

# Create agent user
RUN useradd -m -u 1000 -s /bin/bash agent \
    && mkdir -p /home/agent/.openclaw /home/agent/workspace /overrides \
    && chown -R agent:agent /home/agent /overrides

# Copy base configuration
COPY openclaw.base.json /home/agent/.openclaw/config.json
COPY workspace/AGENTS.md /home/agent/workspace/AGENTS.md
COPY scripts/healthcheck.sh /usr/local/bin/healthcheck.sh
COPY scripts/wait-for-it.sh /usr/local/bin/wait-for-it.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh /usr/local/bin/wait-for-it.sh

USER agent
WORKDIR /home/agent/workspace

EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
