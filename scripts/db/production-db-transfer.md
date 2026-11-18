# Production database backup / restore (manual)

Do **not** reset or drop the existing local `ryd_u` database as part of routine work.  
Prefer a **sanitized** dump when importing from local for first bring-up if PII is not required.

## 1. Inspect local PostgreSQL

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
# Or native service on localhost:5432 / ryd_u
```

## 2. Create a local dump (custom format)

```bash
pg_dump "postgresql://USER:PASSWORD@localhost:5432/ryd_u" -F c -b -f ryd_u_prod_$(date +%Y%m%d).dump
```

## 3. Transfer to VPS

```bash
scp ./ryd_u_prod_YYYYMMDD.dump deploy@82.180.139.178:/opt/drivewize/production/backups/
```

Never commit dumps to git.

## 4. Restore into production Postgres container

```bash
cd /opt/drivewize/production
docker compose -f docker/compose.production.yml --env-file .env.production up -d postgres

docker cp ryd_u_prod_YYYYMMDD.dump "$(docker compose -f docker/compose.production.yml --env-file .env.production ps -q postgres)":/tmp/restore.dump
docker compose -f docker/compose.production.yml --env-file .env.production exec -T postgres \
  pg_restore -U drivewize -d ryd_u --clean --if-exists /tmp/restore.dump
```

## 5. Apply pending Drizzle migrations

```bash
docker compose -f docker/compose.production.yml --env-file .env.production --profile migrate run --rm migrate
```

## 6. Verify

```bash
docker compose -f docker/compose.production.yml --env-file .env.production exec -T postgres \
  psql -U drivewize -d ryd_u -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
```

Application image rollback does **not** undo migrations — restore a pre-migration `.dump` if needed.
