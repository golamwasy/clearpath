FROM eclipse-temurin:23-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew :storefront-api:installDist --no-daemon

FROM eclipse-temurin:23-jre-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/storefront-api/build/install/storefront-api /app
USER app
EXPOSE 8085
ENTRYPOINT ["/app/bin/storefront-api"]
