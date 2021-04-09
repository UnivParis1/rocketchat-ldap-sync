== Configuration

* rocketchat `authUserId` & `authToken`

Retrieve auth token based on login/passowrd

```bash
curl https://chat.univ.fr/api/v1/login -d "username=superadmin&password=superpassword" | cut -d\" -f7-14
# {"userId":"XXXUserIDXXX","authToken":"XXXAuthTokenXXX"}
```