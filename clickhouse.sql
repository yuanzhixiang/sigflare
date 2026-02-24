CREATE TABLE `sigflare`.`events`
(
    -- 时间序列：用 DoubleDelta + ZSTD 压缩率更好（也更符合官方推荐思路）
    `event_time`      DateTime64(3, 'UTC') CODEC (DoubleDelta, ZSTD(3)),

    `event`           LowCardinality(String),

    -- 匿名访客与会话
    `visitor_id`      UInt64,
    `session_id`      UInt64,

    -- 页面（建议 pathname 已经是规范化后的：去掉 query、统一尾斜杠策略等）
    `hostname`        LowCardinality(String) CODEC (ZSTD(3)),
    `pathname`        String CODEC (ZSTD(3)),

    -- 来路：referrer 建议同样做规范化（尤其去掉 query，避免泄漏与爆炸基数）
    `referrer`        String CODEC (ZSTD(3)),
    `referrer_source` LowCardinality(String) CODEC (ZSTD(3)),

    -- 你要求新增的设备/国家/系统/浏览器
    `country`         FixedString(2) DEFAULT 'ZZ',
    `device`          LowCardinality(String) CODEC (ZSTD(3)),

    `os`              LowCardinality(String) CODEC (ZSTD(3)),
    `os_version`      LowCardinality(String) CODEC (ZSTD(3)),
    `browser`         LowCardinality(String) CODEC (ZSTD(3)),
    `browser_version` LowCardinality(String) CODEC (ZSTD(3)),

    -- UTM
    `utm_source`      String CODEC (ZSTD(3)),
    `utm_medium`      String CODEC (ZSTD(3)),
    `utm_campaign`    String CODEC (ZSTD(3))
)
    ENGINE = MergeTree
        PARTITION BY toYYYYMM(`event_time`)
        ORDER BY (toDate(`event_time`), `event_time`, `event`, intHash32(`visitor_id`), `visitor_id`)
        SAMPLE BY intHash32(`visitor_id`)
        SETTINGS index_granularity = 8192;