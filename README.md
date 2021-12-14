== Configuration

* rocketchat `authUserId` & `authToken`

Retrieve personal auth token based on login/passowrd

```bash
username=sync
password=superpassword
url=http://localhost:3000

userId=$(curl -s $url/api/v1/login -d "username=$username&password=$password"  | jq -r '.data.userId')
authToken=$(curl -s $url/api/v1/login -d "username=$username&password=$password"  | jq -r '.data.authToken')
curl -s -H "X-Auth-Token: $authToken" -H "X-User-Id: $userId" -H "Content-type:application/json" $url/api/v1/users.generatePersonalAccessToken -d '{"tokenName": "ldap-sync"}'
# {"token":"XXXPersonalAuthTokenXXX","success":true}
# si token perdu, il faut utiliser :
curl -s -H "X-Auth-Token: $authToken" -H "X-User-Id: $userId" -H "Content-type:application/json" $url/api/v1/users.regeneratePersonalAccessToken -d '{"tokenName": "ldap-sync"}'
```