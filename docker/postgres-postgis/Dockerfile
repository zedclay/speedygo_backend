# Compile PostGIS 3.5 against the official postgres:16-alpine server
# (Alpine apk "postgis" targets PostgreSQL 18 and is the wrong ABI).
FROM postgres:16-alpine

ENV POSTGIS_VERSION=3.5.7

# Source is copied from the host (GitHub is often unreachable from the build container).
# Download: curl -L -o docker/postgres-postgis/postgis-3.5.7.tar.gz \
#   https://github.com/postgis/postgis/archive/3.5.7.tar.gz
COPY postgis-3.5.7.tar.gz /tmp/postgis.tar.gz

RUN set -eux \
  && apk add --no-cache --virtual .fetch-deps ca-certificates tar \
  && mkdir -p /usr/src/postgis \
  && tar --extract --file /tmp/postgis.tar.gz --directory /usr/src/postgis --strip-components 1 \
  && rm /tmp/postgis.tar.gz \
  && apk add --no-cache --virtual .build-deps \
       $DOCKER_PG_LLVM_DEPS \
       gdal-dev geos-dev proj-dev proj-util \
       autoconf automake g++ gcc make libtool \
       libxml2-dev json-c-dev pcre2-dev protobuf-c-dev gettext-dev file perl \
  && cd /usr/src/postgis \
  && ./autogen.sh \
  && ./configure --without-protobuf --without-raster \
  && make -j"$(nproc)" \
  && make install \
  && apk add --no-cache --virtual .postgis-rundeps \
       gdal geos proj json-c libstdc++ pcre2 ca-certificates \
  && cd / \
  && rm -rf /usr/src/postgis \
  && apk del .fetch-deps .build-deps
