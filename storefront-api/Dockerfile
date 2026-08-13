FROM eclipse-temurin:23-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew :storefront-api:installDist --no-daemon

FROM eclipse-temurin:23-jre-alpine
# eclipse-temurin:23-jre-alpine's base Alpine packages lag behind upstream security fixes
# (gnutls/openssl/sqlite-libs CVEs); upgrade in place so the CI vuln scan doesn't fail on
# fixed-upstream CVEs.
RUN apk upgrade --no-cache
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/storefront-api/build/install/storefront-api /app
USER app
EXPOSE 8085
ENTRYPOINT ["/app/bin/storefront-api"]
