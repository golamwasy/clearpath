FROM eclipse-temurin:23-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew :trace-collector:installDist --no-daemon

FROM eclipse-temurin:23-jre
WORKDIR /app
COPY --from=build /app/trace-collector/build/install/trace-collector /app
EXPOSE 8084
ENTRYPOINT ["/app/bin/trace-collector"]
