'use strict';

const _ = require('lodash')
const ldap = require('ldapjs-promise-disconnectwhenidle')

const config = require('./config').ldap

const simplified_affiliation = {
    staff: ["staff", "teacher", "researcher", "emeritus", "retired"],
    student: ["student", "alum"],
}

const simplifyAffiliation = (affiliation) => (
    simplified_affiliation.staff.includes(affiliation) ? "staff" : 
        simplified_affiliation.student.includes(affiliation) ? "student" : "guest"
)

const civilite_to_gender_suffix = (civilite) => (
    civilite === 'M.' ? ';x-gender-m' :
        civilite === 'Mme' || civilite === 'Mlle' ? ';x-gender-f' : ''
)


async function simple_ldap_search(base, filter, attributes, options) {
    try {
        const l = await ldap.search(base, filter, attributes, options || {})
        return l.map(e => _.pick(e, attributes))
    } catch (err) {
        console.error(err)
        return []
    }
}

async function simple_ldap_search_one(base, filter, attributes) {
    const l = await simple_ldap_search(base, filter, attributes, { sizeLimit: 1 })
    return l[0]
}


let structures = { guest: { ou: "Visiteur" } }
async function cache_structures_once() {
    const l = await simple_ldap_search(
        'ou=structures,' + config.base,
        '(objectClass=*)',
        [ 'supannCodeEntite', 'ou', 'description', 'up1Flags', 'supannCodeEntiteParent' ],
    )
    for (const { up1Flags, ...structure } of l) {            
        // keep only useful parents
        if (!ldap.manyAttrs(up1Flags).includes("included")) {
            delete structure.supannCodeEntiteParent
        }
        if (structure.ou) {
            const regex = "^([A-Z][A-Z0-9]+( [0-9]+)?|" + _.escapeRegExp(structure.ou) + ") : "
            structure.description = structure.description.replace(new RegExp(regex), '')
        }
        structures[structure.supannCodeEntite] = structure
    }
    _.each(structures, (structure) => {
        if (structure.supannCodeEntiteParent) {
            structure.parent = structures[structure.supannCodeEntiteParent]
        }
    })
}

async function cache_structures() {
    await cache_structures_once()
    // Update structures every hours
    setInterval(cache_structures_once, 1 /* hour */ * 60 * 60 * 1000);
}

async function getRoleGenerique_no_cache(key, gender_suffix) {
    const role = await simple_ldap_search_one(
        'ou=supannRoleGenerique,ou=tables,' + config.base,
        '(up1TableKey=' + key + ')',
        [ 'displayName', 'displayName;x-gender-m', 'displayName;x-gender-f' ],
    )
    return role && role['displayName' + gender_suffix]
}

let roleGenerique_cache = {}
async function getRoleGenerique(key, gender_suffix) {
    const cache_key = key + gender_suffix
    if (!roleGenerique_cache[cache_key]) {
        roleGenerique_cache[cache_key] = await getRoleGenerique_no_cache(key, gender_suffix)
    }
    return roleGenerique_cache[cache_key]
}

async function getUsers(filter) {
    const users = await simple_ldap_search(
        "ou=people," + config.base,
        filter,
        [ config.username_attr, 'displayName', 'mail', 'eduPersonPrimaryAffiliation', 'supannEntiteAffectationPrincipale', 'supannRoleGenerique', 'supannCivilite', 'supannListeRouge', 'modifyTimestamp' ],
    )
    return await Promise.all(users.map(exportUser))
}
async function exportUser(user) {
    const gender_suffix = civilite_to_gender_suffix(user.supannCivilite)
    let affectation = {}
    if (user.supannEntiteAffectationPrincipale) {
        affectation = structures[user.supannEntiteAffectationPrincipale]
        if (!affectation) {
            console.error("unknown structure " + user.supannEntiteAffectationPrincipale)
            affectation = {};
        }
    }

    return { 
        ...user,
        username: user[config.username_attr],
        supannListeRouge: user.supannListeRouge === "TRUE",
        affectation,
        supannRoleGenerique: await Promise.all(ldap.manyAttrs(user.supannRoleGenerique).map(key => getRoleGenerique(key, gender_suffix))),
    }
}

async function getUser(username) {
    return (await getUsers("(" + config.username_attr + "=" + username + ")"))[0]
}


async function init() {
    ldap.init({
        uri: config.uri,
        dn: config.binddn,
        password: config.password,
        disconnectWhenIdle_duration: 5 /* seconds */ * 1000,
        verbose: true,
    });
    await cache_structures()
}

module.exports = { init, getUser, getUsers }
