FROM eclipse-temurin:23-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew :menu-service:installDist --no-daemon

FROM eclipse-temurin:23-jre-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/menu-service/build/install/menu-service /app
USER app
EXPOSE 8081
ENTRYPOINT ["/app/bin/menu-service"]
