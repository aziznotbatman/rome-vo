alter table raw_snapshots add column body_md5 text;
update raw_snapshots set body_md5 = md5(body);
alter table raw_snapshots alter column body_md5 set not null;
create index raw_snapshots_url_hash on raw_snapshots (url, body_md5);
