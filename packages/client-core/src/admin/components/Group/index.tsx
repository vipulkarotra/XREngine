import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@mui/material/Button'
import Grid from '@mui/material/Grid'

import Search from '../../common/Search'
import styles from '../../styles/admin.module.scss'
import { useStyles } from '../../styles/ui'
import CreateGroup from './CreateGroup'
import GroupTable from './GroupTable'

const GroupConsole = () => {
  const classes = useStyles()
  const [groupOpen, setGroupOpen] = useState(false)
  const [search, setSearch] = React.useState('')
  const { t } = useTranslation()

  const openModalCreate = (open: boolean) => {
    setGroupOpen(open)
  }
  const handleChange = (e: any) => {
    setSearch(e.target.value)
  }

  return (
    <React.Fragment>
      <div>
        <Grid container spacing={3} className={classes.marginBottom}>
          <Grid item xs={12} sm={9}>
            <Search text="group" handleChange={handleChange} />
          </Grid>
          <Grid item xs={12} sm={3}>
            <Button
              className={styles.openModalBtn}
              type="submit"
              variant="contained"
              onClick={() => openModalCreate(true)}
            >
              {t('admin:components.group.createGroup')}
            </Button>
          </Grid>
        </Grid>
        <div className={classes.rootTableWithSearch}>
          <GroupTable search={search} />
        </div>
      </div>
      <CreateGroup open={groupOpen} handleClose={openModalCreate} />
    </React.Fragment>
  )
}

export default GroupConsole
