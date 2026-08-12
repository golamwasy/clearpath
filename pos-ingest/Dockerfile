FROM golang:1.25-alpine AS build
WORKDIR /app
COPY pos-ingest/ ./pos-ingest/
WORKDIR /app/pos-ingest
RUN go mod download
RUN CGO_ENABLED=0 go build -o /pos-ingest ./cmd/server

FROM alpine:3.20
COPY --from=build /pos-ingest /pos-ingest
COPY pos-ingest/migrations /migrations
EXPOSE 8083
ENTRYPOINT ["/pos-ingest"]
