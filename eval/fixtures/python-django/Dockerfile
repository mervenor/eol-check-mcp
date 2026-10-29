ARG PYTHON_VERSION=3.8
FROM python:${PYTHON_VERSION}-slim-bullseye
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["gunicorn", "bookings.wsgi"]
