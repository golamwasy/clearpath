FROM golang:1.25-alpine AS build
WORKDIR /app
COPY mocks/flat-pos/ ./
RUN CGO_ENABLED=0 go build -o /flat-pos .

FROM alpine:3.20
COPY --from=build /flat-pos /flat-pos
EXPOSE 9002
ENTRYPOINT ["/flat-pos"]
