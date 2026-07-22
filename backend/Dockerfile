FROM ruby:3.4.10-slim

# Packages needed to build native extensions:
#   - build-essential: compiler toolchain
#   - libpq-dev:       pg gem
#   - libyaml-dev:     psych gem (Ruby 3.4 bundles psych 5.x which needs libyaml)
#   - git:             some gems resolve git sources
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      build-essential \
      libpq-dev \
      libyaml-dev \
      git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# /app is bind-mounted from the host in docker-compose.yml (for hot reload),
# which means Gemfile.lock on disk IS the host's file. Without this, any
# runtime bundler invocation (e.g. via db:prepare) that notices the container's
# platform isn't in Gemfile.lock's PLATFORMS will silently add it and rewrite
# the host's lockfile. This must be an env var (not `bundle config --local`,
# which would write to /app/.bundle and get hidden by the bind mount) so it
# survives the mount and keeps the lockfile fixed at build time only.
ENV BUNDLE_FROZEN="true"

# Install gems first so the layer is cached unless Gemfile changes.
COPY Gemfile Gemfile.lock ./
RUN bundle install

COPY . .

EXPOSE 3001

ENTRYPOINT ["bin/docker-entrypoint.sh"]
CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "3001"]
