plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
}

group = "com.clearpath"
version = "0.1.0"

val ktorVersion = "2.3.12"
val kafkaVersion = "3.8.0"
val logbackVersion = "1.5.8"

dependencies {
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    api("io.ktor:ktor-server-metrics-micrometer:$ktorVersion")
    api("io.micrometer:micrometer-registry-prometheus:1.13.6")
    implementation("org.apache.kafka:kafka-clients:$kafkaVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("ch.qos.logback:logback-classic:$logbackVersion")

    testImplementation(kotlin("test"))
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

tasks.test {
    useJUnitPlatform()
}
