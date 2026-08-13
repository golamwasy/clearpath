plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
    application
}

group = "com.clearpath"
version = "0.1.0"

val ktorVersion = "2.3.12"
val exposedVersion = "0.55.0"
val koinVersion = "3.5.6"
val kafkaVersion = "3.8.0"
val logbackVersion = "1.5.8"

dependencies {
    implementation(project(":tracing-core"))

    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktorVersion")
    implementation("io.ktor:ktor-server-call-logging:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages:$ktorVersion")
    implementation("io.ktor:ktor-server-request-validation:$ktorVersion")
    implementation("io.ktor:ktor-server-cors:$ktorVersion")
    // ktor-server-metrics-micrometer / micrometer-registry-prometheus come transitively from
    // tracing-core's installMetrics() — every Kotlin service here uses it.

    implementation("io.insert-koin:koin-ktor:$koinVersion")

    implementation("org.jetbrains.exposed:exposed-core:$exposedVersion")
    implementation("org.jetbrains.exposed:exposed-jdbc:$exposedVersion")
    implementation("org.jetbrains.exposed:exposed-java-time:$exposedVersion")
    implementation("org.postgresql:postgresql:42.7.4")
    implementation("com.zaxxer:HikariCP:5.1.0")
    implementation("org.flywaydb:flyway-core:10.17.3")
    implementation("org.flywaydb:flyway-database-postgresql:10.17.3")

    implementation("org.apache.kafka:kafka-clients:$kafkaVersion")

    implementation("ch.qos.logback:logback-classic:$logbackVersion")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    testImplementation(kotlin("test"))
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
    testImplementation("org.testcontainers:junit-jupiter:1.21.4")
    testImplementation("org.testcontainers:postgresql:1.21.4")
    testImplementation("org.testcontainers:kafka:1.21.4")
    testImplementation("org.testcontainers:testcontainers:1.21.4")
}

java {
    sourceCompatibility = JavaVersion.toVersion(22)
    targetCompatibility = JavaVersion.toVersion(22)
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_22)
    }
}

application {
    mainClass.set("com.clearpath.menu.ApplicationKt")
}

tasks.test {
    useJUnitPlatform()
}
