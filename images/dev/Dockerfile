FROM devteam/base:latest

# Copy persona configuration
COPY openclaw.json /home/agent/persona/openclaw.json
COPY workspace/ /home/agent/persona/workspace/
COPY skills/ /home/agent/persona/skills/

USER agent
WORKDIR /home/agent/workspace
