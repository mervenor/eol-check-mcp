# Build stage
FROM mcr.microsoft.com/dotnet/sdk:6.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish Web.csproj -c Release -o /app/publish

# Front-end assets
FROM node:12-alpine AS assets
WORKDIR /client
COPY ClientApp/ .
RUN npm ci && npm run build

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:6.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
COPY --from=assets /client/dist ./wwwroot
ENTRYPOINT ["dotnet", "Web.dll"]
