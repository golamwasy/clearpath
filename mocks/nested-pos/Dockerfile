FROM golang:1.25-alpine AS build
WORKDIR /app
COPY mocks/nested-pos/ ./
RUN CGO_ENABLED=0 go build -o /nested-pos .

FROM alpine:3.20
COPY --from=build /nested-pos /nested-pos
EXPOSE 9001
ENTRYPOINT ["/nested-pos"]
