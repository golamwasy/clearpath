FROM eclipse-temurin:23-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew :availability-service:installDist --no-daemon

FROM eclipse-temurin:23-jre
WORKDIR /app
COPY --from=build /app/availability-service/build/install/availability-service /app
EXPOSE 8082
ENTRYPOINT ["/app/bin/availability-service"]
