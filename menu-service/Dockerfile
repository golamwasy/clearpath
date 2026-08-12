FROM eclipse-temurin:23-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew :menu-service:installDist --no-daemon

FROM eclipse-temurin:23-jre
WORKDIR /app
COPY --from=build /app/menu-service/build/install/menu-service /app
EXPOSE 8081
ENTRYPOINT ["/app/bin/menu-service"]
