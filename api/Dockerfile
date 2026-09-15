# Query service (api/) image for Google Cloud Run (see docs/DEPLOY_API.md, section 2).
# Build from the repository root; Cloud Run runs linux/amd64.
# Local test: docker build --platform linux/amd64 -f api/Dockerfile -t aqi-query .
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && python -c "import duckdb; duckdb.connect().execute('INSTALL httpfs')"

COPY api ./api

ENV PYTHONPATH=/app PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8000
# One process: DuckDB runs each query on its own cursor in a worker thread, so requests still overlap.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
