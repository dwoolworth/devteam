FROM devteam/base:latest

# Playwright needs root to install browser system dependencies
USER root
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Evidence directory for screenshots
RUN mkdir -p /home/agent/evidence \
    && chown agent:agent /home/agent/evidence

# Persona files
COPY openclaw.json /home/agent/persona/openclaw.json
COPY workspace/ /home/agent/persona/workspace/
COPY skills/ /home/agent/persona/skills/

USER agent
WORKDIR /home/agent/workspace
