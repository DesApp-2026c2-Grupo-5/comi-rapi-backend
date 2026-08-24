#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER unahur_covid WITH PASSWORD 'coronavirus';
    
    CREATE DATABASE unahur_covid_dev;
    GRANT ALL PRIVILEGES ON DATABASE unahur_covid_dev TO unahur_covid;
    
    CREATE DATABASE unahur_covid_test;
    GRANT ALL PRIVILEGES ON DATABASE unahur_covid_test TO unahur_covid;
EOSQL
