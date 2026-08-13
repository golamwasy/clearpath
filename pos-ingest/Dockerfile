FROM golang:1.25-alpine AS build
WORKDIR /app
COPY pos-ingest/ ./pos-ingest/
WORKDIR /app/pos-ingest
RUN go mod download
RUN CGO_ENABLED=0 go build -o /pos-ingest ./cmd/server

FROM alpine:3.20
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /pos-ingest /pos-ingest
COPY --chown=app:app pos-ingest/migrations /migrations
USER app
EXPOSE 8083
ENTRYPOINT ["/pos-ingest"]
