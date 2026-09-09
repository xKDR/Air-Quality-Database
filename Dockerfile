FROM python:3.12-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# DuckDB extensions used by the exporter (postgres scanner) and the api (httpfs for reading R2 directly).
RUN python -c "import duckdb; c = duckdb.connect(); c.execute('INSTALL postgres'); c.execute('INSTALL httpfs')"

COPY api ./api
COPY exporter ./exporter
COPY stations ./stations

ENV PYTHONPATH=/app PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
