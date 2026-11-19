FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY bot ./bot
COPY lib ./lib
COPY api ./api
COPY migrations ./migrations
COPY main.py ./main.py
EXPOSE 8000
CMD ["python", "-m", "main"]
