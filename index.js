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

const compute_rooms = (user) => (
    [ "staff", "teacher", "researcher", "emeritus" ].includes(user.eduPersonPrimaryAffiliation) ?
    [
        user.affectation,
        user.affectation.parent,
    ].filter(a => a && a.ou).map(({ ou, description }) => ({ fname: ou, description })) : []
)


async function sync_ldap_user(ldap_user) {
    try {
        await rocketchat.sync_user(ldap_user.username, { email: ldap_user.mail, name: ldap_user.displayName, bio: compute_bio(ldap_user) }, compute_rooms(ldap_user))
    } catch (e) {
        console.error(e)
    }
}

async function sync_user(username) {
    try {
        const ldap_user = await ldap.getUser(username)
        if (!ldap_user) {
            console.log("ignoring unknown LDAP user", username)
            return
        }
        await sync_ldap_user(ldap_user)
    } catch (e) {
        console.error(e)
    }
}

async function sync_users(filter) {
    for (const ldap_user of await ldap.getUsers(filter)) {
        await sync_ldap_user(ldap_user)
    }
}

ldap.init().then(_ => {
    const [,,cmd,...args] = process.argv
    if (cmd === 'listen_users_logging_in') {
        console.log("listen_users_logging_in")
        rocketchat.listen_users_logging_in(sync_user, error => { console.error(error); process.exit(1) })
    } else if (cmd === 'sync_users') {
        sync_users(args[0])
    }
})
