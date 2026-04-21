ARG BUILD_FROM
FROM ${BUILD_FROM}

ENV LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# aiohttp + websockets; sqlite3 is already part of Python stdlib
RUN pip install --no-cache-dir \
        "aiohttp==3.9.5" \
        "websockets==12.0"

# Copy the app (includes /app and /run.sh via rootfs)
COPY rootfs /

RUN chmod a+x /run.sh

CMD ["/run.sh"]
