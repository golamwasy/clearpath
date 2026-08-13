plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
    application
}

group = "com.clearpath"
version = "0.1.0"

val ktorVersion = "2.3.12"
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
    implementation("io.ktor:ktor-server-cors:$ktorVersion")
    // ktor-server-metrics-micrometer / micrometer-registry-prometheus come transitively from
    // tracing-core's installMetrics() — every Kotlin service here uses it.

    // outbound calls to menu-service/availability-service — this is the first service in the
    // repo that composes reads from other services rather than only handling inbound HTTP.
    implementation("io.ktor:ktor-client-core:$ktorVersion")
    implementation("io.ktor:ktor-client-cio:$ktorVersion")
    implementation("io.ktor:ktor-client-content-negotiation:$ktorVersion")

    implementation("io.insert-koin:koin-ktor:$koinVersion")

    implementation("org.apache.kafka:kafka-clients:$kafkaVersion")

    implementation("redis.clients:jedis:5.2.0")

    implementation("ch.qos.logback:logback-classic:$logbackVersion")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    testImplementation(kotlin("test"))
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
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
    mainClass.set("com.clearpath.storefront.ApplicationKt")
}

tasks.test {
    useJUnitPlatform()
}
