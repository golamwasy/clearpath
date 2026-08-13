FROM eclipse-temurin:23-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew :trace-collector:installDist --no-daemon

FROM eclipse-temurin:23-jre-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/trace-collector/build/install/trace-collector /app
USER app
EXPOSE 8084
ENTRYPOINT ["/app/bin/trace-collector"]
