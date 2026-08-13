FROM eclipse-temurin:23-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew :availability-service:installDist --no-daemon

FROM eclipse-temurin:23-jre-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/availability-service/build/install/availability-service /app
USER app
EXPOSE 8082
ENTRYPOINT ["/app/bin/availability-service"]
