# PRODUCTION
git reset --hard
git checkout master
git pull origin master

docker compose down
docker compose up -d