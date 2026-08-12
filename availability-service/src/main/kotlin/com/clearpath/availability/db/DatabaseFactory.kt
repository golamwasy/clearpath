package com.clearpath.availability.db

import com.clearpath.availability.AppConfig
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.sql.Database

object DatabaseFactory {

    /**
     * Returns an Exposed Database handle rather than relying on Exposed's implicit
     * process-wide default, so multiple services can each connect to their own
     * database inside the same JVM (as the integration test does) without one
     * connect() call silently overriding another's default.
     */
    fun connect(config: AppConfig): Database {
        val hikariConfig = HikariConfig().apply {
            jdbcUrl = config.dbUrl
            username = config.dbUser
            password = config.dbPassword
            driverClassName = "org.postgresql.Driver"
            maximumPoolSize = 10
        }
        val dataSource = HikariDataSource(hikariConfig)

        Flyway.configure()
            .dataSource(dataSource)
            .locations("classpath:db/migration/availability")
            .load()
            .migrate()

        return Database.connect(dataSource)
    }
}
