#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE unahur_desapp_test;
  GRANT ALL PRIVILEGES ON DATABASE unahur_desapp_test TO unahur_desapp;
EOSQL
