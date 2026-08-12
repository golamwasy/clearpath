#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE USER menu WITH PASSWORD 'menu';
    CREATE DATABASE menu OWNER menu;

    CREATE USER availability WITH PASSWORD 'availability';
    CREATE DATABASE availability OWNER availability;
EOSQL
