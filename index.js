const ldap = require('./ldap')
const rocketchat = require('./rocketchat')

const compute_bio = (user) => (
    [
        ...user.supannRoleGenerique,
        user.affectation.ou,
        user.affectation.description,
        (user.affectation.parent || {}).description,
    ].filter(s => s).join(', ')
)

const compute_rooms = (user) => ([
    user.affectation.ou,
    ...user.affectation.parent ? [user.affectation.parent.ou] : []
])


async function sync_user(username) {
    try {
        const ldap_user = await ldap.getUser(username)
        if (!ldap_user) {
            console.log("ignoring unknown LDAP user", username)
            return
        }
        await rocketchat.sync_user(username, { bio: compute_bio(ldap_user) }, compute_rooms(ldap_user))
    } catch (e) {
        console.error(e)
    }
}

ldap.init()
rocketchat.listen_users_logging_in(sync_user)
