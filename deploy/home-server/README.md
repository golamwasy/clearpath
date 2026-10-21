# Home-server deployment (pull-based)

CI builds the images and, once every test and the vulnerability scan passed, publishes them to
GHCR. Nothing in this repository runs on the server. The server runs `deploy.sh` from cron every
minute; it pulls the seven application images and restarts the stack only if one changed.

- `docker-compose.yml`: reference copy of the file the server runs from `~/deploy/clearpath`. The
  server never reads it from git, so a change to the repository cannot change how containers are
  started (mounts, privileges, networks). Edit the server's copy to change that.
- `deploy.sh`: reference copy of the pull script.
- The two bind-mounted files (`docker/postgres-init.sh`, `pos-ingest/venues.json`) are read from a
  fixed folder on the server and are **not** updated automatically. Copy a changed file there by
  hand, then `docker compose up -d` in `~/deploy/clearpath`.
