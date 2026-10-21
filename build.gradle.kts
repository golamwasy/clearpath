plugins {
    kotlin("jvm") version "2.0.21" apply false
    kotlin("plugin.serialization") version "2.0.21" apply false
}

allprojects {
    repositories {
        mavenCentral()
    }
}

// ktor-server-netty 2.3.12 brings netty 4.1.111, which has CVE-2026-75595 (fixed in 4.1.137).
// Keep Ktor as is and move the whole netty family to a patched 4.1.x release instead.
subprojects {
    plugins.withId("org.jetbrains.kotlin.jvm") {
        dependencies {
            add("implementation", platform("io.netty:netty-bom:4.1.139.Final"))
        }
    }
}
