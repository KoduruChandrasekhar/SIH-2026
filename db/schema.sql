-- TraceNet Phase 4 — PostgreSQL 16 + PostGIS 3.4 schema.
--
-- Idempotent: applied by docker-entrypoint-initdb.d on first container start and by
-- `python -m backend.db.migrate` at any time. Columns beyond the base spec are marked
-- "(wiring)": they link rows back to Phase 2/3 and keep data provenance explicit.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- ─── Cameras ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cameras (
    id              VARCHAR(26) PRIMARY KEY,               -- ULID
    camera_code     VARCHAR(32) UNIQUE NOT NULL,           -- CAM-401 …
    road_name       VARCHAR(128) NOT NULL,
    junction_name   VARCHAR(128) NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    location        GEOMETRY(Point, 4326)
                    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED,
    bearing_degrees REAL DEFAULT 0.0,
    is_active       BOOLEAN DEFAULT TRUE,
    installed_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cameras_location_gist ON cameras USING GIST (location);

-- ─── Vehicle observations (one per Phase 2 transit / fused sighting) ─────────
CREATE TABLE IF NOT EXISTS vehicle_observations (
    id                   VARCHAR(26) PRIMARY KEY,          -- ULID
    camera_id            VARCHAR(26) NOT NULL REFERENCES cameras(id),
    plate_number         VARCHAR(16),                      -- plate as read at this camera (NULL = unreadable)
    canonical_plate      VARCHAR(16),                      -- resolved vehicle plate (upper-case, no spaces)
    confidence           REAL NOT NULL,
    q_score              REAL NOT NULL,                    -- Phase 2 pre-OCR crop quality (0 = no plate crop)
    appearance_embedding BYTEA,                            -- packed 512-D float32
    integrity_flags      VARCHAR(32) DEFAULT 'VALID',
    observed_at          TIMESTAMPTZ NOT NULL,
    location             GEOMETRY(Point, 4326) NOT NULL,
    crop_path            TEXT,
    -- (wiring)
    sighting_id          VARCHAR(128) UNIQUE,              -- Phase 2 observation id / Phase 3 sighting id
    trajectory_id        VARCHAR(36),                      -- global_trajectories.id
    global_vehicle_id    VARCHAR(36),                      -- UUIDv5 vehicle identity
    vehicle_class        VARCHAR(24),
    vehicle_bbox         JSONB,
    source               VARCHAR(16) NOT NULL DEFAULT 'phase2',   -- phase2 | simulated | seed_backdrop
    fusion_decision      JSONB
);
CREATE INDEX IF NOT EXISTS idx_obs_observed_at ON vehicle_observations (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_plate_trgm ON vehicle_observations USING GIN (plate_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_obs_location_gist ON vehicle_observations USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_obs_canonical_plate ON vehicle_observations (canonical_plate, observed_at);
CREATE INDEX IF NOT EXISTS idx_obs_trajectory ON vehicle_observations (trajectory_id, observed_at);

-- ─── Global trajectories (one per journey) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS global_trajectories (
    id                 VARCHAR(36) PRIMARY KEY,            -- UUIDv5 journey id
    canonical_plate    VARCHAR(16),
    first_seen         TIMESTAMPTZ NOT NULL,
    last_seen          TIMESTAMPTZ NOT NULL,
    observation_count  INTEGER DEFAULT 1,
    total_distance_km  DOUBLE PRECISION DEFAULT 0.0,
    trajectory_line    GEOMETRY(LineString, 4326),         -- NULL until ≥ 2 observations
    is_cloned_alert    BOOLEAN DEFAULT FALSE,
    updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- (wiring)
    global_vehicle_id  VARCHAR(36) NOT NULL,               -- UUIDv5 vehicle identity (uuid5(plate))
    trajectory_line_m  GEOMETRY(LineStringM, 4326),        -- 4D: M = UNIX epoch seconds
    average_speed_kmh  DOUBLE PRECISION DEFAULT 0.0,
    status             VARCHAR(16) DEFAULT 'ACTIVE',       -- ACTIVE | COMPLETED
    source             VARCHAR(16) NOT NULL DEFAULT 'phase2',
    aliases            JSONB DEFAULT '[]'::jsonb,          -- promoted ghost ids
    legs               JSONB DEFAULT '[]'::jsonb           -- Phase 3 per-waypoint speed / match breakdown
);
CREATE INDEX IF NOT EXISTS idx_trajectories_line_gist ON global_trajectories USING GIST (trajectory_line);
CREATE INDEX IF NOT EXISTS idx_trajectories_canonical_plate ON global_trajectories (canonical_plate);
CREATE INDEX IF NOT EXISTS idx_trajectories_vehicle ON global_trajectories (global_vehicle_id);

-- ─── Kinematic anomalies (Phase 3 cloned-plate alerts, Phase 6 dispatch) ─────
CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id                 VARCHAR(36) PRIMARY KEY,
    alert_type         VARCHAR(32) NOT NULL,
    severity           VARCHAR(16) NOT NULL,
    plate_number       VARCHAR(16),
    camera_a           VARCHAR(32),
    camera_b           VARCHAR(32),
    time_delta_seconds DOUBLE PRECISION,
    road_distance_km   DOUBLE PRECISION,
    implied_speed_kmh  DOUBLE PRECISION,
    global_vehicle_id  VARCHAR(36),
    detected_at        TIMESTAMPTZ NOT NULL,
    source             VARCHAR(16) NOT NULL DEFAULT 'phase2',
    payload            JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anomalies_detected ON anomaly_alerts (detected_at DESC);

-- ─── Tamper-evident audit log ────────────────────────────────────────────────
-- row_hash = sha256(prev_hash|user_id|queried_plate|executed_at ISO|reason); prev_hash of
-- the first row is 64 zeros. Rows are only ever appended.
CREATE TABLE IF NOT EXISTS query_audit_log (
    id            BIGSERIAL PRIMARY KEY,
    user_id       VARCHAR(64) NOT NULL,
    queried_plate VARCHAR(16) NOT NULL,
    reason        TEXT NOT NULL,
    executed_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    prev_hash     CHAR(64),
    row_hash      CHAR(64) NOT NULL
);

-- ─── Phase 5: macro traffic analytics (written by the Polars job) ────────────
-- corridor_stats: per camera, hourly buckets (window_label '1h') plus a rolling rollup
-- (window_label '24h', bucket_start = window start). BCI = 1 - v_observed / v_freeflow.
CREATE TABLE IF NOT EXISTS corridor_stats (
    camera_code     VARCHAR(32) NOT NULL REFERENCES cameras(camera_code),
    window_label    VARCHAR(8)  NOT NULL,
    bucket_start    TIMESTAMPTZ NOT NULL,
    bucket_end      TIMESTAMPTZ NOT NULL,
    vehicle_count   INTEGER NOT NULL,              -- every observed chassis (plate or not)
    plated_count    INTEGER NOT NULL,              -- integrity VALID
    ocr_yield       REAL,                          -- share of vehicles with confidence > 0.80
    avg_speed_kmh   REAL,                          -- mean speed of cross-camera legs touching the camera
    speed_samples   INTEGER NOT NULL DEFAULT 0,
    avg_delay_min   REAL,                          -- mean leg delay vs free-flow travel time
    bci_score       REAL,                          -- NULL when there is no speed evidence
    status          VARCHAR(24) NOT NULL,          -- STATUS_SEVERE | STATUS_MODERATE | STATUS_FREE | STATUS_NO_DATA
    is_severe       BOOLEAN NOT NULL DEFAULT FALSE,
    source_counts   JSONB,                         -- observations per data source
    computed_at     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (camera_code, window_label, bucket_start)
);
CREATE INDEX IF NOT EXISTS idx_corridor_stats_window ON corridor_stats (window_label, bucket_start);

-- od_matrix: camera-to-camera trips from contiguous trajectory legs (rolling 24 h window)
CREATE TABLE IF NOT EXISTS od_matrix (
    source_camera      VARCHAR(32) NOT NULL REFERENCES cameras(camera_code),
    destination_camera VARCHAR(32) NOT NULL REFERENCES cameras(camera_code),
    window_start       TIMESTAMPTZ NOT NULL,
    window_end         TIMESTAMPTZ NOT NULL,
    trip_count         INTEGER NOT NULL,
    unique_vehicles    INTEGER NOT NULL,
    avg_travel_minutes REAL,
    avg_speed_kmh      REAL,
    computed_at        TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source_camera, destination_camera)
);

-- analytics_runs: one row per Polars job execution (scheduler health / provenance)
CREATE TABLE IF NOT EXISTS analytics_runs (
    id            BIGSERIAL PRIMARY KEY,
    started_at    TIMESTAMPTZ NOT NULL,
    finished_at   TIMESTAMPTZ,
    duration_ms   REAL,
    read_engine   VARCHAR(16),
    rows_read     INTEGER,
    legs          INTEGER,
    status        VARCHAR(16) NOT NULL,           -- ok | error
    error         TEXT,
    stats         JSONB
);

-- ─── Phase 6: watchlist (blacklist) ──────────────────────────────────────────
-- The live fusion service keeps an in-memory copy (O(1) lookups) refreshed on change.
CREATE TABLE IF NOT EXISTS watchlist (
    plate        VARCHAR(16) PRIMARY KEY,           -- canonical plate (upper-case, alphanumerics)
    threat_level VARCHAR(8)  NOT NULL DEFAULT 'HIGH' CHECK (threat_level IN ('HIGH', 'MEDIUM', 'LOW')),
    reason       TEXT        NOT NULL,
    added_by     VARCHAR(64) NOT NULL,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active       BOOLEAN     NOT NULL DEFAULT TRUE
);
-- the Phase 6 demo target
INSERT INTO watchlist (plate, threat_level, reason, added_by)
VALUES ('DL01XY0001', 'HIGH', 'Demo target: stolen vehicle (FIR 0001/2026)', 'seed')
ON CONFLICT (plate) DO NOTHING;

-- ─── RBAC: user directory (completion plan 3.3) ──────────────────────────────
-- The JWT identity provider reads users from here (a built-in copy of the two demo accounts is the
-- fallback when the database is down). Passwords: salted PBKDF2-SHA256, 200 000 rounds - never plaintext.
-- A token is only valid while its user is active and still holds the role written in the token.
CREATE TABLE IF NOT EXISTS users (
    username      VARCHAR(32) PRIMARY KEY,
    name          VARCHAR(80) NOT NULL,
    role          VARCHAR(24) NOT NULL CHECK (role IN ('camera_admin', 'law_enforcement')),
    salt          CHAR(32)    NOT NULL,
    password_hash CHAR(64)    NOT NULL,
    active        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by    VARCHAR(32) NOT NULL DEFAULT 'seed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- demo accounts: admin / admin123 (camera_admin), officer / police123 (law_enforcement)
INSERT INTO users (username, name, role, salt, password_hash) VALUES
    ('admin',   'System Administrator', 'camera_admin',
     '90014a5516d9e385e7bcb66953c9b3c6', 'd3da518c90342e32d566344e26475b280cee9a9ee480d531c1170f4a85e05e12'),
    ('officer', 'Police Operator',      'law_enforcement',
     'c0275de44270af820e4ee733197b2d6e', '293ad1fa89028f913c310cc32606cda8378766478b90f3713c88f09c9e6037ba')
ON CONFLICT (username) DO NOTHING;

-- administrative actions (user created / role changed / deactivated / password reset)
CREATE TABLE IF NOT EXISTS admin_events (
    id         BIGSERIAL PRIMARY KEY,
    at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor      VARCHAR(32) NOT NULL,
    action     VARCHAR(32) NOT NULL,
    target     VARCHAR(64),
    detail     JSONB
);
CREATE INDEX IF NOT EXISTS idx_admin_events_at ON admin_events (at DESC);
