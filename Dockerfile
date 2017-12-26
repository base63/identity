FROM node

MAINTAINER Base63 team <horia141@gmail.com>

# Setup users and groups.

RUN groupadd base63 && \
    useradd -ms /bin/bash -g base63 base63

# Copy source code.

RUN mkdir /base63
COPY . /base63
RUN chown -R base63:base63 /base63/out

# Setup the runtime environment for the application.

ENV ENV LOCAL
ENV ADDRESS 0.0.0.0
ENV PORT 10000
ENV DATABASE_URL postgresql://base63:base63@base63-postgres:5432/base63
ENV DATABASE_MIGRATIONS_DIR /base63/migrations
ENV DATABASE_MIGRATIONS_TABLE migrations_identity
ENV ORIGIN http://localhost:10001
ENV CLIENTS http://localhost:10002,http://localhost:10003,http://localhost:10004

WORKDIR /base63
EXPOSE 10000
USER base63
ENTRYPOINT ["npm", "run", "serve-dev"]
